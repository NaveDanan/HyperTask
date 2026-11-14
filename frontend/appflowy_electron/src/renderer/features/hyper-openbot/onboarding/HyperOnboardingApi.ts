// Adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { hyperOpenBotRequest } from '../transport';
export interface HyperOnboardingStatus { step: number; completedAt: string | null }
export interface HyperOnboardingUser { id: string; name?: string | null; email: string; needsName?: boolean; role: string; onboarding: HyperOnboardingStatus | null }
export interface HyperSetupFix { kind: 'env' | 'page'; names?: string[]; docsUrl?: string; label?: string; path?: string; page?: { label: string; path: string } }
export interface HyperSetupRow { id: string; title: string; detail: string; required: boolean; ready: boolean; status: 'ready' | 'needs_setup' | 'not_checked'; fix: HyperSetupFix | null }
export interface HyperSetupChecklist { audience: 'admin' | 'member'; rows: HyperSetupRow[] }
export const HyperReadUser = async () => (await hyperOpenBotRequest<{ user: HyperOnboardingUser | null }>('/api/me')).user;
export const HyperReadCapabilities = () => hyperOpenBotRequest<{ localEvaluation: boolean; generativeUi: boolean; edition: string }>('/api/capabilities');
export const HyperReadSetup = async () => (await hyperOpenBotRequest<{ checklist: HyperSetupChecklist }>('/api/setup')).checklist;
export const HyperRecheckSetup = async () => { await hyperOpenBotRequest('/api/setup/check', 'POST'); return HyperReadSetup(); };
export const HyperSaveOnboarding = async (value: { step: number } | { completed: true }) => {
  await hyperOpenBotRequest('/api/me/onboarding', 'POST', value);
  return HyperReadUser();
};
export const HyperSaveOnboardingName = async (name: string) => {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) throw new Error('Enter a name of 1 to 100 characters.');
  await hyperOpenBotRequest('/api/me/profile', 'PATCH', { name: trimmed });
  return HyperReadUser();
};
export function HyperMayOpenSetup(user: HyperOnboardingUser | null, capabilities?: { localEvaluation: boolean }) { return user?.role === 'admin' || capabilities?.localEvaluation === true; }
