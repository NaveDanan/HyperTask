import { collectComposerInlineTokens } from './HyperPromptInlineTokens';

export type ComposerPromptSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; path: string; source: string }
  | { type: 'skill'; name: string; source: string }
  | { type: 'command' | 'person'; label: string; source: string };

export const HYPER_PROMPT_COMMANDS = [
  { name: 'model', description: 'Switch the response model for this message' },
  { name: 'create-skill', description: 'Create a reusable skill with this bot' },
  { name: 'create-tool', description: 'Create a custom tool with this bot' },
] as const;

export function markdownMathRanges(text: string) {
  return [...text.matchAll(/(?<!\\)(?:\$\$[\s\S]+?\$\$|\$(?![\s$])[^\n$]*?[^\n\s$](?<!\\)\$(?!\d)|\\\[[\s\S]+?\\\]|\\\([^\n]+?\\\))/g)]
    .map(match => ({ start: match.index, end: match.index + match[0].length }));
}

export function splitPromptIntoComposerSegments(prompt: string): ComposerPromptSegment[] {
  type Token = Exclude<ComposerPromptSegment, { type: 'text' }> & { start: number; end: number };
  const tokens: Token[] = collectComposerInlineTokens(prompt, { findMath: markdownMathRanges }).map(token =>
    token.type === 'mention' ? { ...token, path: token.value } : { ...token, name: token.value },
  );
  const references = /(^|\s)(@\[((?:\\.|[^\]\\\n])*)\]\(mailto:[^\s()]+\)|\/[a-z][\w-]*)(?=\s)/gi;
  for (const match of prompt.matchAll(references)) {
    const [, prefix = '', source = '', person] = match;
    const start = match.index + prefix.length;
    if (person !== undefined) {
      tokens.push({ type: 'person', label: `@${person.replace(/\\(.)/g, '$1')}`, source, start, end: start + source.length });
    } else if ((start === 0 || /^@[^\s]+\s*$/u.test(prompt.slice(0, start))) && HYPER_PROMPT_COMMANDS.some(command => `/${command.name}` === source.toLowerCase())) {
      tokens.push({ type: 'command', label: source, source, start, end: start + source.length });
    }
  }

  const segments: ComposerPromptSegment[] = [];
  let cursor = 0;
  for (const token of tokens.sort((left, right) => left.start - right.start || right.end - left.end)) {
    if (token.start < cursor) continue;
    if (token.start > cursor) segments.push({ type: 'text', text: prompt.slice(cursor, token.start) });
    segments.push(token);
    cursor = token.end;
  }
  if (cursor < prompt.length) segments.push({ type: 'text', text: prompt.slice(cursor) });
  return segments;
}
