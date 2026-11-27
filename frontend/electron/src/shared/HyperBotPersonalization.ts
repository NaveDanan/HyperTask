import { z } from 'zod';

export const HYPER_BOT_MEMORY_CATEGORIES = ['general', 'tasks', 'calendar', 'email'] as const;
export const HYPER_BOT_SOUL_FIELDS = ['tone', 'detail', 'format', 'language'] as const;
export const HYPER_BOT_MEMORY_LIMIT = 40;
export const HYPER_BOT_SUGGESTION_LIMIT = 24;
export const HYPER_BOT_DISMISSAL_LIMIT = 120;
export const HYPER_BOT_PREFERENCE_LENGTH = 240;

export const HyperBotPersonalizationMode = z.enum(['off', 'manual', 'learn']);
const Preference = z.string().trim().min(1).max(HYPER_BOT_PREFERENCE_LENGTH);
export const HyperBotPreferenceDraft = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('memory'), category: z.enum(HYPER_BOT_MEMORY_CATEGORIES), topic: z.string().trim().min(1).max(60), value: Preference }),
  z.strictObject({ kind: z.literal('soul'), field: z.enum(HYPER_BOT_SOUL_FIELDS), value: Preference }),
]);
export type HyperBotPreferenceDraft = z.infer<typeof HyperBotPreferenceDraft>;

const Source = z.strictObject({ messageId: z.uuid(), at: z.iso.datetime(), quote: Preference, signal: z.enum(['stated', 'inferred']) });
const Entry = z.strictObject({ id: z.uuid(), draft: HyperBotPreferenceDraft, updatedAt: z.iso.datetime(), source: Source.omit({ quote: true, signal: true }).optional() });
const Suggestion = z.strictObject({ id: z.uuid(), draft: HyperBotPreferenceDraft, source: Source });
export type HyperBotPreference = z.infer<typeof Entry>;
export type HyperBotPreferenceSuggestion = z.infer<typeof Suggestion>;

export const HyperBotPersonalizationView = z.strictObject({
  revision: z.int().min(0),
  mode: HyperBotPersonalizationMode,
  entries: z.array(Entry).max(HYPER_BOT_MEMORY_LIMIT + HYPER_BOT_SOUL_FIELDS.length),
  suggestions: z.array(Suggestion).max(HYPER_BOT_SUGGESTION_LIMIT),
});
export type HyperBotPersonalizationView = z.infer<typeof HyperBotPersonalizationView>;
export const HyperBotPersonalizationState = HyperBotPersonalizationView.extend({
  contextRevision: z.int().min(0).default(0),
  dismissed: z.array(z.string().regex(/^[a-f0-9]{32}$/)).max(HYPER_BOT_DISMISSAL_LIMIT),
});
export type HyperBotPersonalizationState = z.infer<typeof HyperBotPersonalizationState>;

export const HyperBotPersonalizationTarget = z.strictObject({ botId: z.string().regex(/^[a-z0-9-]{1,32}$/) });
export const HyperBotPersonalizationUpdate = HyperBotPersonalizationTarget.extend({
  revision: z.int().min(0),
  change: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('mode'), mode: HyperBotPersonalizationMode }),
    z.strictObject({ type: z.literal('save'), id: z.uuid().optional(), draft: HyperBotPreferenceDraft }),
    z.strictObject({ type: z.literal('remove'), id: z.uuid() }),
    z.strictObject({ type: z.literal('accept'), id: z.uuid(), draft: HyperBotPreferenceDraft.optional() }),
    z.strictObject({ type: z.literal('dismiss'), id: z.uuid() }),
    z.strictObject({ type: z.literal('clear') }),
  ]),
});
export type HyperBotPersonalizationUpdate = z.infer<typeof HyperBotPersonalizationUpdate>;
