// Copyright (c) 2026 CopilotKit. MIT. See ../LICENSE and REUSE.md.
// Adapted from app/src/lib/notifications/{permission,show}.ts and components/notifications/notify-prompt.tsx.
import { useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
export type HyperNotificationPermission = NotificationPermission | 'unsupported';
const listeners = new Set<() => void>();
export function HyperNotificationPermissionState(): HyperNotificationPermission {
  try { return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission; }
  catch { return 'unsupported'; }
}
export function HyperRefreshNotificationPermission() { for (const listener of listeners) listener(); }
export async function HyperRequestNotificationPermission(): Promise<HyperNotificationPermission> {
  if (HyperNotificationPermissionState() === 'unsupported') return 'unsupported';
  try { const value = await Notification.requestPermission(); HyperRefreshNotificationPermission(); return value; }
  catch { return 'unsupported'; }
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function HyperUseNotificationPermission() {
  return useSyncExternalStore(subscribe, HyperNotificationPermissionState, () => 'unsupported' as const);
}
export const HYPER_NOTIFY_PROMPT_KEY = 'openbot-notify-prompt-answered';
function answered() { try { return localStorage.getItem(HYPER_NOTIFY_PROMPT_KEY) !== null; } catch { return false; } }
function remember() { try { localStorage.setItem(HYPER_NOTIFY_PROMPT_KEY, new Date().toISOString()); } catch { /* Permission still hides the prompt. */ } }
export function HyperNotifyPrompt() {
  const permission = HyperUseNotificationPermission();
  const [dismissed, setDismissed] = useState(answered);
  if (permission !== 'default' || dismissed) return null;
  return <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4" data-notify-prompt="">
    <p>Get notified when your Bot finishes or needs your approval.</p>
    <Button variant="ghost" onClick={() => { remember(); setDismissed(true); }}>Not now</Button>
    <Button variant="outline" onClick={() => { remember(); void HyperRequestNotificationPermission().then(() => setDismissed(true)); }}>Enable notifications</Button>
  </div>;
}
export type HyperNotice = { title: string; body: string; tag: string; path: string; onClick?: () => void };
export const HyperConversationTag = (channelId: string) => 'openbot-' + channelId;
export const HyperInSight = () => document.visibilityState === 'visible' && document.hasFocus();
/** Electron's Notification API delivers the native notice without Tauri's upstream IPC. */
export function HyperShowNotice(notice: HyperNotice) {
  try {
    const shown = new Notification(notice.title, { body: notice.body, tag: notice.tag });
    if (notice.onClick) shown.onclick = () => { window.focus(); notice.onClick?.(); shown.close(); };
  } catch { /* Refusal leaves the in-app inbox available. */ }
}
export function HyperNotificationSettings() {
  const permission = HyperUseNotificationPermission();
  return <section className="space-y-2"><h2 className="font-semibold">Notifications on this computer</h2>
    <p>{permission === 'granted' ? 'Notifications are enabled.' : permission === 'denied' ? 'Notifications are blocked. Change your system notification settings, then check again.' : permission === 'unsupported' ? 'Notifications are unavailable on this computer.' : 'Enable notifications when your Bot finishes or needs you.'}</p>
    {permission === 'default' && <Button variant="outline" onClick={() => void HyperRequestNotificationPermission()}>Enable notifications</Button>}
    {permission === 'denied' && <Button variant="outline" onClick={HyperRefreshNotificationPermission}>Check again</Button>}
  </section>;
}
