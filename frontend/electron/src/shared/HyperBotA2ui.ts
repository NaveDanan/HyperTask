import { AgentToRendererMessageSchema, basicCatalog, type AgentToRendererMessage } from '@a2ui/web_core/v1_0';
import { z } from 'zod';

type BasicComponent = NonNullable<ReturnType<typeof basicCatalog.components.get>>;
type BasicFunction = NonNullable<ReturnType<typeof basicCatalog.functions.get>>;

export const hyperBotA2uiCatalog: typeof basicCatalog = basicCatalog.derive<BasicComponent, BasicFunction>({
  catalogId: 'https://a2ui.hypertask.local/catalogs/hyper-bot/v1.json',
  components: ['Text', 'Card', 'Column', 'Row', 'List', 'Divider', 'Tabs', 'Button', 'TextField', 'CheckBox', 'ChoicePicker', 'Slider', 'DateTimeInput'],
  functions: ['required', 'length', 'numeric', 'email', 'formatString', 'formatNumber', 'formatCurrency', 'formatDate', 'pluralize', 'and', 'or', 'not', '@index'],
  instructions: 'Use compact cards and descriptive button labels. When a card uses a title, put a short Text component first. Use the caption variant for supporting details. A button can submit form values or request a follow-up. Use an Event with a simple snake_case name and bind its context to the needed input values. Only include context needed for the action.',
});

export type HyperBotA2uiMessage = Extract<AgentToRendererMessage,
  { createSurface: unknown } | { updateComponents: unknown } | { updateDataModel: unknown } | { deleteSurface: unknown }>;

export const HyperBotA2uiMessages = z.array(z.custom<HyperBotA2uiMessage>(value => {
  const result = AgentToRendererMessageSchema.safeParse(value);
  return result.success && ('createSurface' in result.data || 'updateComponents' in result.data ||
    'updateDataModel' in result.data || 'deleteSurface' in result.data);
})).min(1).max(64);

const actionValue = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);
export const HyperBotA2uiActionSchema = z.strictObject({
  surfaceId: z.string().min(1).max(128),
  sourceComponentId: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  context: z.record(z.string().min(1).max(128), z.union([actionValue, z.array(actionValue).max(24)]))
    .refine(context => Object.keys(context).length <= 24 && JSON.stringify(context).length <= 8000, 'Interactive reply values are too large.'),
});

export type HyperBotA2uiAction = z.infer<typeof HyperBotA2uiActionSchema>;
export const HyperBotA2uiInteractionSchema = z.strictObject({
  messageId: z.uuid(),
  action: HyperBotA2uiActionSchema,
});
export type HyperBotA2uiInteraction = z.infer<typeof HyperBotA2uiInteractionSchema>;
