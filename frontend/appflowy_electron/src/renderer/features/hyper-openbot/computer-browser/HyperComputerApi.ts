// Adapted from OpenBot lib/browser, lib/bot-browser and lib/computers/control.
// Copyright (c) 2026 CopilotKit. MIT.
import { hyperOpenBotRequest } from '../transport';
export interface HyperBrowserState {
  shows?: 'native' | 'screen'; narration?: 'own' | 'external'; available?: boolean; note?: string; problem?: string; computerId?: string; open: boolean;
  mine?: boolean; recordingIsMine?: boolean; recordRefused?: string;
  tabs: { id: string; title: string; url: string; active: boolean }[];
  recorder?: { phase: string; actions: number; title?: string; lastStopped?: { actions: number; phrases: number; sending?: boolean; retrying?: string; kept?: string; discarded?: boolean } };
}
export interface HyperControl { holder: 'bot' | 'human'; heldBy?: string; transitioning: boolean; since?: string; recoveryRequired?: boolean; reason?: string; secretWanted?: string; secretRef?: string; secretSnapshotId?: number; request?: { id: string; source: string; status: string } }
export const hyperComputerPath = (id: string) => `/api/computers/${encodeURIComponent(id)}`;
export const hyperBrowserPath = (id?: string) => id ? `${hyperComputerPath(id)}/browser` : '/api/browser';
export const hyperReadBrowser = (id?: string) => hyperOpenBotRequest<HyperBrowserState>(hyperBrowserPath(id));
export const hyperBrowserAction = (id: string | undefined, action: 'open' | 'close' | 'clear' | 'tabs' | 'navigate' | 'recording', body?: unknown) => hyperOpenBotRequest<HyperBrowserState>(`${hyperBrowserPath(id)}/${action}`, 'POST', body);
export const hyperReadControl = (id: string) => hyperOpenBotRequest<HyperControl>(`${hyperComputerPath(id)}/control`);
export async function hyperTakeControl(id: string, requestId?: string, beforeTake?: (requestId: string) => Promise<boolean>) {
  const request = requestId ?? (await hyperOpenBotRequest<HyperControl>(`${hyperComputerPath(id)}/control/request`, 'POST', { reason: 'I want to take control of the browser.', source: 'manual' })).request?.id;
  if (!request) throw new Error('The computer did not grant a control request.');
  if (beforeTake && !await beforeTake(request)) throw new Error('The control request is no longer current.');
  return hyperOpenBotRequest<HyperControl>(`${hyperComputerPath(id)}/control/take`, 'POST', { requestId: request });
}
export const hyperReleaseControl = (id: string, requestId: string) => hyperOpenBotRequest<HyperControl>(`${hyperComputerPath(id)}/control/release`, 'POST', { requestId });
