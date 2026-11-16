import { beforeEach, expect, it, vi } from 'vitest';
import { hyperOpenBotRequest } from '../transport';
import { hyperReadQuestions, hyperGroupQuestion, hyperQuestionRecipient, hyperAnswerQuestion, hyperDismissQuestion, hyperPartsAnswer } from './HyperGroupQuestions';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
const request = vi.mocked(hyperOpenBotRequest);
beforeEach(() => request.mockReset());
it('selects the first matching group question and respects handoff recipients', () => {
  const question = { id: 'q', channelId: 'group', botId: 'worker', conversationBotId: 'owner', question: 'Proceed?' };
  expect(hyperGroupQuestion([{ ...question, channelId: 'other' }, question], 'group')).toBe(question);
  expect(hyperGroupQuestion([question], 'other')).toBeUndefined();
  expect(hyperQuestionRecipient(question, null)).toBe(true);
  expect(hyperQuestionRecipient(question, 'owner')).toBe(true);
  expect(hyperQuestionRecipient(question, 'worker')).toBe(false);
});
it('uses upstream inbox, answer and dismissal contracts without inConversation', async () => {
  await hyperReadQuestions(); expect(request).toHaveBeenLastCalledWith('/api/approvals');
  await hyperAnswerQuestion('question id', 'Yes');
  expect(request).toHaveBeenLastCalledWith('/api/approvals/questions/question%20id/respond', 'POST', { response: 'Yes' });
  await hyperDismissQuestion('question id');
  expect(request).toHaveBeenLastCalledWith('/api/approvals/questions/question%20id/dismiss', 'POST');
  request.mockRejectedValueOnce(new Error('refused'));
  await expect(hyperAnswerQuestion('q', 'Yes')).rejects.toThrow('refused');
});
it('formats multi-part answers with options and free text using upstream labels', () => {
  const form = new FormData(); form.append('part-0', ' One '); form.append('part-0', 'Two'); form.append('part-1', ' custom ');
  expect(hyperPartsAnswer([{ header: 'Choice', question: '?' }, { header: 'Reason', question: '?' }], form)).toBe('Choice: One, Two\nReason: custom');
});
