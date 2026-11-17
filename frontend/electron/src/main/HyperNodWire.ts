import { z } from 'zod';
import type { HyperNodHistoryPage, HyperNodMessage, HyperNodSnapshot, HyperNodSubmitted } from '@shared/HyperNod';
/** Pinned Nod response contracts (src/shared/contracts.ts). Unknown fields are dropped before IPC. */
const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });
export const HyperNodActivitySchema = z.object({
  turnId: uuid, title: z.string().max(2000).nullable(), step: z.string().max(2000).nullable(),
  doing: z.enum(['queued', 'model', 'tool']), tool: z.string().max(200).optional(),
}).transform(({ turnId, title, step, doing, tool }) => ({ turnId, title, step, doing, ...(tool ? { tool } : {}) }));
const choices = z.object({
  multiple: z.boolean(),
  options: z.array(z.object({ id: uuid, label: z.string().max(120), description: z.string().max(400).optional() })).min(1).max(6),
});
const message = z.object({
  id: uuid, role: z.enum(['user', 'assistant']), text: z.string(), displayText: z.string().nullish(),
  turnId: uuid.nullable(), createdAt: instant, streamId: z.string().max(200).nullish(),
  attachments: z.array(z.object({ id: uuid, name: z.string().max(1000), mimeType: z.string().max(200), size: z.number().nonnegative() })).max(64).default([]),
  answerChoices: choices.nullish(), answerChoicesPending: z.boolean().nullish(),
  approval: z.object({
    id: uuid, state: z.enum(['pending', 'working', 'done', 'declined', 'expired', 'uncertain']), title: z.string().max(1000), app: z.string().max(200),
    fields: z.array(z.object({ label: z.string().max(200), value: z.string().max(20000) })).max(50).optional(), body: z.string().max(200000).optional(), bodyCut: z.boolean().optional(),
  }).nullish(),
}).transform((value): HyperNodMessage => ({
  id: value.id, role: value.role, text: value.role === 'user' && value.displayText ? value.displayText : value.text,
  turnId: value.turnId, createdAt: value.createdAt, streamId: value.streamId ?? null,
  attachments: value.attachments.map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size })),
  ...(value.answerChoices ? { choices: { multiple: value.answerChoices.multiple, options: value.answerChoices.options.map(({ id, label, description }) => ({ id, label, ...(description ? { description } : {}) })) } } : {}),
  choicesPending: value.answerChoicesPending === true,
  ...(value.approval ? { approval: {
    id: value.approval.id, state: value.approval.state, title: value.approval.title, app: value.approval.app,
    fields: (value.approval.fields ?? []).map(({ label, value: text }) => ({ label, value: text })), ...(value.approval.body ? { body: value.approval.body } : {}), bodyCut: value.approval.bodyCut === true,
  } } : {}),
}));
const turn = z.object({
  id: uuid, status: z.enum(['queued', 'running', 'succeeded', 'waiting', 'failed', 'cancelled']),
  createdAt: instant, finishedAt: instant.nullish(), error: z.string().max(4000).nullish(),
}).transform(({ id, status, createdAt, finishedAt, error }) => ({ id, status, createdAt, finishedAt: finishedAt ?? null, error: error ?? null }));
export const HyperNodConfigurationSchema = z.object({
  provider: z.string().max(200), model: z.string().max(200), llmReady: z.boolean(),
  modelIssue: z.object({ reason: z.string().max(2000) }).optional(),
});
export const HyperNodStateSchema = z.object({
  threadId: uuid, messages: z.array(message).max(500), turns: z.array(turn).max(1000),
  hasEarlierMessages: z.boolean().optional(), activity: z.array(HyperNodActivitySchema).max(500).optional(),
  hiddenMessageIds: z.array(uuid).max(1000).optional(), hiddenMessageCount: z.number().int().nonnegative().optional(), pendingAnswerChoiceMessageIds: z.array(uuid).max(1000).optional(),
}).transform((value): HyperNodSnapshot => ({
  threadId: value.threadId, messages: value.messages, turns: value.turns, hasEarlierMessages: value.hasEarlierMessages === true, activity: value.activity ?? [],
  hiddenMessageIds: value.hiddenMessageIds ?? [], hiddenMessageCount: value.hiddenMessageCount ?? value.hiddenMessageIds?.length ?? 0, pendingQuestionIds: value.pendingAnswerChoiceMessageIds ?? null,
}));
export const HyperNodHistorySchema = z.object({ messages: z.array(message).max(100), hasMore: z.boolean() })
  .transform((value): HyperNodHistoryPage => value);
export const HyperNodSubmittedSchema = z.object({ threadId: uuid, turnId: uuid, messageId: uuid })
  .transform(({ threadId, turnId, messageId }): HyperNodSubmitted => ({ threadId, turnId, messageId }));
export const HyperNodHealthSchema = z.object({ ok: z.literal(true) });
export const HyperNodStoppedSchema = z.object({ ok: z.literal(true) });
export const HyperNodErrorSchema = z.object({ error: z.string(), code: z.string().max(100).optional() });
