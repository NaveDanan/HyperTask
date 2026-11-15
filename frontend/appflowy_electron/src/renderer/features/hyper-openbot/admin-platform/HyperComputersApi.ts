// Adapted from OpenBot, Copyright (c) 2026 CopilotKit, MIT. See ../LICENSE and REUSE.md.
import { hyperOpenBotRequest } from '../transport';
export interface HyperComputer { computer: string; kind: 'person' | 'bot'; person?: { name: string | null; email: string }; botId?: string; running: boolean; startedAt: string | null; egress?: string | null; updateAvailable?: boolean }
export interface HyperHostAccess { connected: boolean; desktop?: boolean; grants: { id: string; botId: string; displayName: string; revoked?: boolean; ownerName?: string; ownerEmail?: string }[]; pending: { operationId: string; kind?: string; botId: string; ownerName?: string; ownerEmail?: string }[] }
export interface HyperNetworkRule { type: 'domain' | 'cidr'; value: string; ports?: string }
export interface HyperNetworkPolicy { scopeKind: 'organization' | 'group'; scopeId: string; mode: 'allow_all' | 'defaults_plus_allowlist' | 'allowlist_only'; rules: HyperNetworkRule[]; locked: boolean }
export interface HyperComputerControls { settings: { inactiveComputerDays: number }; groups: string[]; network: HyperNetworkPolicy[]; defaultDestinations: string[] }
export interface HyperNetworkTranslation { mode: HyperNetworkPolicy['mode']; rules: HyperNetworkRule[]; check: { ok: boolean; error?: string; problems?: string[] }; reachable?: string[]; explanation?: string | null; warning?: string | null; summary?: string | null }
export const hyperLoadFleet = () => hyperOpenBotRequest<{ computers: HyperComputer[]; isolation?: 'shared' | 'per-person' }>('/api/computers/fleet');
export const hyperLoadHostAccess = () => hyperOpenBotRequest<HyperHostAccess>('/api/host-access');
export const hyperLoadComputerControls = () => hyperOpenBotRequest<HyperComputerControls>('/api/admin/enterprise');
export const hyperChangeComputer = (computer: HyperComputer, action: 'stop' | 'reset' | 'update') => hyperOpenBotRequest('/api/computers/fleet', 'POST', { action, computer: computer.computer, ...(computer.botId ? { botId: computer.botId } : {}) });
export const hyperClearOwnBrowser = () => hyperOpenBotRequest('/api/browser/clear', 'POST');
export const hyperRequestFolder = (botId: string) => hyperOpenBotRequest('/api/host-access/grants', 'POST', { botId });
export const hyperRevokeFolder = (id: string) => hyperOpenBotRequest(`/api/host-access/grants/${encodeURIComponent(id)}`, 'DELETE');
export const hyperStopFolders = () => hyperOpenBotRequest('/api/host-access/stop', 'POST');
export const hyperSweepComputers = () => hyperOpenBotRequest<{ stopped: string[] }>('/api/admin/enterprise/computers/terminate-inactive', 'POST');
export function hyperSetInactiveDays(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 3650) throw new Error('Enter a whole number from 0 to 3650.');
  return hyperOpenBotRequest('/api/admin/enterprise/settings/inactiveComputerDays', 'PUT', { value });
}
export function hyperNetworkRules(text: string): HyperNetworkRule[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [value = '', ports] = line.split(/\s+/, 2);
    const type = hyperIsNetworkAddress(value) ? 'cidr' as const : 'domain' as const;
    return { type, value, ...(ports ? { ports } : {}) };
  });
}
function hyperIsNetworkAddress(value: string): boolean {
  const [address, prefix, extra] = value.split('/');
  if (extra !== undefined || !address) return false;
  const octets = address.split('.');
  let bits: number;
  if (octets.length === 4 && octets.every(part => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)) bits = 32;
  else {
    if (!address.includes(':') || !/^[\da-fA-F:.]+$/.test(address)) return false;
    try { new URL(`http://[${address}]/`); } catch { return false; }
    bits = 128;
  }
  return prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) <= bits);
}
export const hyperSaveNetwork = (policy: HyperNetworkPolicy, text?: string) => hyperOpenBotRequest('/api/admin/enterprise/network', 'PUT', { ...policy, ...(text ? { authoring: { source: 'english', text } } : {}) });
export const hyperRemoveNetwork = (policy: HyperNetworkPolicy) => hyperOpenBotRequest(`/api/admin/enterprise/network/${policy.scopeKind}${policy.scopeKind === 'group' ? `?group=${encodeURIComponent(policy.scopeId)}` : ''}`, 'DELETE');
export const hyperTranslateNetwork = (text: string) => hyperOpenBotRequest<HyperNetworkTranslation>('/api/admin/enterprise/network/translate', 'POST', { text });
export interface HyperNetworkReplay { scanned: number; covered: number; wouldBlock: number; wouldAllow: number; undecided: number; unchanged: number; sites: number; hosts: { host: string; change: string; visits: number; bots: string[]; lastVisit: string }[] }
export const hyperReplayNetwork = (policy: HyperNetworkPolicy) => hyperOpenBotRequest<{ report: HyperNetworkReplay }>('/api/admin/enterprise/network/replay', 'POST', policy);
