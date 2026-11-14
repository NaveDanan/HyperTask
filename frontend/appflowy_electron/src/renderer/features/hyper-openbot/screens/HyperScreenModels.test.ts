import { describe, expect, it } from 'vitest';
import { HyperConversationTitle, HyperGrantSummary, HyperGroupRoster, HyperSortConnections } from './HyperScreenModels';

describe('Hyper screen models', () => {
  it('keeps assigned shared Bots pinned without duplicating them', () => {
    const assigned = { id: 'assigned', name: 'Assigned', mine: false, assignedToMe: true };
    const mine = { id: 'mine', name: 'Mine', mine: true };
    const shared = { id: 'shared', name: 'Shared', mine: false };
    expect(HyperGroupRoster([assigned, mine, shared])).toEqual({ pinned: [assigned], yours: [mine], shared: [shared] });
  });
  it('uses first words before the reply and skips blank openings', () => {
    expect(HyperConversationTitle({ opening: ' Question ', lastMessage: 'Reply' })).toBe('Question');
    expect(HyperConversationTitle({ opening: ' ', lastMessage: ' Reply ' })).toBe('Reply');
    expect(HyperConversationTitle({ summary: 'Title', opening: 'Question' })).toBe('Title');
    expect(HyperConversationTitle({})).toBe('');
  });
  it('keeps reconnect and team accounts in use, preserving order', () => {
    const rows = [
      { key: 'new', title: 'New', summary: '', state: 'available' as const },
      { key: 'expired', title: 'Expired', summary: '', state: 'needs_reconnect' as const },
      { key: 'team', title: 'Team', summary: '', state: 'team' as const },
    ];
    expect(HyperSortConnections(rows).map(row => row.key)).toEqual(['expired', 'team', 'new']);
    expect(rows[0].key).toBe('new');
  });
  it('names grant coverage at both ends', () => {
    expect(HyperGrantSummary(0, 0)).toBe('No Bots');
    expect(HyperGrantSummary(1, 1)).toBe('1 Bot');
    expect(HyperGrantSummary(2, 2)).toBe('All Bots');
    expect(HyperGrantSummary(1, 3)).toBe('1 of 3 Bots');
  });
});
