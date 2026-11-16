// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
import { hyperOpenBotRequest as request } from '../transport';
export async function hyperReplyToConversationQuestion(question: { id: string; question: string }, response: string) {
  const result = await request<{ continueHere?: boolean }>(`/api/approvals/questions/${encodeURIComponent(question.id)}/respond`, 'POST', { response, inConversation: true });
  return { continueHere: result?.continueHere === true, message: { id: `person-response:${question.id}`, role: 'user' as const, content: `In response to your question: ${question.question}\n\n${response}` } };
}
export function hyperShownQuestionAnswer(id: string, text: string) {
  if (!id.startsWith('person-response:') || !text.startsWith('In response to your question: ')) return text;
  const split = text.indexOf('\n\n'); return split === -1 ? text : text.slice(split + 2);
}
export function hyperHasUnseenActivity(channel: { lastMessageAgentId?: string | null; lastMessageAt?: string | null; lastReadAt?: string | null }) {
  return !!channel.lastMessageAgentId && !!channel.lastMessageAt && (!channel.lastReadAt || channel.lastMessageAt > channel.lastReadAt);
}
