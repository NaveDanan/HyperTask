import { A2uiGenerator, CatalogConfig } from '@a2ui/agent';
import { ActionSchema, MessageProcessor } from '@a2ui/web_core/v1_0';
import { HyperBotA2uiMessages, hyperBotA2uiCatalog, type HyperBotA2uiAction, type HyperBotA2uiMessage } from '@shared/HyperBotA2ui';

const generator = new A2uiGenerator([new CatalogConfig(hyperBotA2uiCatalog)]);
const processor = generator.createProcessor({ '1.0': { supportedCatalogIds: [hyperBotA2uiCatalog.id] } });

export const hyperBotA2uiPrompt = [
  'You can include an interactive A2UI panel when the owner requests one or when a form, choices, or tabs would help. For ordinary questions answer in Markdown. Put a concise Markdown summary before any A2UI block.',
  'Each reply starts with a new surface. Make controls describe the information they submit or request. Buttons can request follow-up information and submit form values. Workspace changes and other external writes must start from a typed request, so do not offer buttons that claim to perform them. Never ask for passwords, API keys, or sign-in information.',
  processor.promptSnippet,
].join('\n\n');

export function hyperBotA2uiReply(content: string): { text: string; a2ui?: HyperBotA2uiMessage[] } {
  if (!processor.parser.hasFormatContent(content)) return { text: content };
  const raw = processor.parser.unwrap(content);
  const text = raw.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n\n').trim();
  const fallback = { text: text || 'The interactive reply could not be displayed. Try asking again.' };
  if (raw.some(part => part.type === 'a2ui' && !part.isFinal)) return fallback;
  try {
    const state = processor.createState();
    const parts = processor.parseResponse(content, { state });
    const messages = HyperBotA2uiMessages.safeParse(parts.flatMap(part => part.type === 'a2ui' ? part.a2ui : []));
    if (messages.success && state.surfaceIds.length) return { text, a2ui: messages.data };
  } catch { /* Keep the readable reply when the model output fails A2UI validation. */ }
  return fallback;
}

export function hyperBotA2uiActionLabel(messages: HyperBotA2uiMessage[], action: HyperBotA2uiAction): string | null {
  const replay = new MessageProcessor([hyperBotA2uiCatalog]);
  try {
    replay.processMessages(messages);
    const surface = replay.getSurface(action.surfaceId);
    const control = surface?.componentsModel.get(action.sourceComponentId);
    if (control?.type !== 'Button') return null;
    const parsed = ActionSchema.safeParse(control.properties.action);
    if (!parsed.success || !('event' in parsed.data) || parsed.data.event.name !== action.name) return null;
    const context = parsed.data.event.context ?? {};
    if (Object.keys(action.context).some(key => !Object.hasOwn(context, key))) return null;
    const child = surface?.componentsModel.get(control.properties.child);
    const label: unknown = child?.type === 'Text' ? child.properties.text : undefined;
    return (typeof label === 'string' ? label : action.name.replaceAll('_', ' ')).replace(/\s+/g, ' ').trim().slice(0, 150) || 'Interactive reply';
  } catch { return null; }
  finally { replay.dispose(); }
}
