export interface HyperMention { name: string; email: string }
export type HyperMentionPart = { kind: 'text'; text: string; start: number; end: number } | { kind: 'mention'; person: HyperMention; start: number; end: number };
const emailPattern = /^[^\s@<>()[\]\\]+@[^\s@<>()[\]\\]+\.[^\s@<>()[\]\\]+$/u;
export function hyperSerializeMention(person: HyperMention): string {
  if (!emailPattern.test(person.email)) return person.name;
  return '@[' + person.name.replace(/[\r\n]/g, ' ').replace(/\\/g, '\\\\').replace(/\]/g, '\\]') + '](mailto:' + person.email.toLowerCase() + ')';
}
export function hyperParseMentions(value: string): HyperMentionPart[] {
  const pattern = /@\[((?:\\.|[^\]\\\r\n])*)\]\(mailto:([^\s()]+)\)/gu;
  const parts: HyperMentionPart[] = []; let start = 0;
  for (const match of value.matchAll(pattern)) {
    if (!emailPattern.test(match[2])) continue;
    if (match.index > start) parts.push({ kind: 'text', text: value.slice(start, match.index), start, end: match.index });
    const end = match.index + match[0].length;
    parts.push({ kind: 'mention', person: { name: match[1].replace(/\\(.)/gu, '$1'), email: match[2].toLowerCase() }, start: match.index, end }); start = end;
  }
  if (start < value.length) parts.push({ kind: 'text', text: value.slice(start), start, end: value.length });
  return parts;
}

/** Find a complete plain-text name without searching inside serialized mentions. */
export function hyperFindPlainPersonSpan(value: string, name: string) {
  const needle = name.trim().replace(/^@/, '').replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
  if (!needle) return undefined;
  const nameChar = "[\\p{L}\\p{M}\\p{N}_@'’׳-]";
  const pattern = new RegExp('(?<!' + nameChar + ')@?' + needle + '(?!' + nameChar + ')', 'iu');
  for (const part of hyperParseMentions(value)) {
    if (part.kind !== 'text') continue;
    const match = pattern.exec(part.text);
    if (match) return { start: part.start + match.index, end: part.start + match.index + match[0].length, text: match[0] };
  }
}
