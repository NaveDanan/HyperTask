// Derived from OpenBot. Copyright (c) 2026 CopilotKit. MIT License; see REUSE.md.
export interface HyperConversation {
  id: string;
  name: string;
  summary?: string | null;
  opening?: string | null;
  lastMessage?: string | null;
  pinned?: boolean;
  unreadCount?: number;
}
export interface HyperBot {
  id: string;
  name: string;
  title?: string | null;
  roleDescription?: string | null;
  mine: boolean;
  pinned?: boolean;
  assignedToMe?: boolean;
  paused?: boolean;
  waitingCount?: number;
}
export interface HyperSkill {
  slug: string;
  title: string;
  summary?: string | null;
  grantedTo: readonly string[];
}
export interface HyperConnection {
  key: string;
  title: string;
  summary: string;
  state: 'connected' | 'needs_reconnect' | 'team' | 'available';
  action?: 'connect' | 'add' | 'setup';
  noAccount?: boolean;
  notConnected?: boolean;
}
export function HyperGroupRoster(bots: readonly HyperBot[]) {
  const pinned = (bot: HyperBot) => bot.pinned || bot.assignedToMe === true;
  const rest = bots.filter(bot => !pinned(bot));
  return { pinned: bots.filter(pinned), yours: rest.filter(bot => bot.mine), shared: rest.filter(bot => !bot.mine) };
}
export function HyperSortConnections(rows: readonly HyperConnection[]): HyperConnection[] {
  return [...rows.filter(row => row.state !== 'available'), ...rows.filter(row => row.state === 'available')];
}
export function HyperConversationTitle(row: Pick<HyperConversation, 'summary' | 'opening' | 'lastMessage'>): string {
  return (row.summary || row.opening?.trim() || row.lastMessage?.trim() || '').trim();
}

export function HyperGrantSummary(held: number, total: number): string {
  if (held === 0) return 'No Bots';
  if (held === total) return total === 1 ? '1 Bot' : 'All Bots';
  return `${held} of ${total} Bots`;
}
