import { expect, it, vi } from 'vitest';
import { hyperReplyToConversationQuestion, hyperShownQuestionAnswer, hyperHasUnseenActivity } from './HyperQuestionReply';
import { hyperOpenBotRequest } from '../transport';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
it('answers through the original continuation contract with stable stored identity', async () => {
  vi.mocked(hyperOpenBotRequest).mockResolvedValueOnce({ continueHere: true });
  const result = await hyperReplyToConversationQuestion({ id: 'q id', question: 'Which?' }, 'This one');
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/approvals/questions/q%20id/respond', 'POST', { response: 'This one', inConversation: true });
  expect(result).toEqual({ continueHere: true, message: { id: 'person-response:q id', role: 'user', content: 'In response to your question: Which?\n\nThis one' } });
  expect(hyperShownQuestionAnswer(result.message.id, result.message.content)).toBe('This one');
});
it('marks only newer Bot activity unread, including server clocks ahead of local time', () => {
  expect(hyperHasUnseenActivity({ lastMessageAgentId: 'bot', lastMessageAt: '2099-01-01', lastReadAt: '2026-01-01' })).toBe(true);
  expect(hyperHasUnseenActivity({ lastMessageAgentId: null, lastMessageAt: '2099-01-01' })).toBe(false);
  expect(hyperHasUnseenActivity({ lastMessageAgentId: 'bot', lastMessageAt: '2026-01-01', lastReadAt: '2026-01-01' })).toBe(false);
});
