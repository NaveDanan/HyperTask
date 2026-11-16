import type { HyperPerson } from '@shared/api';
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
export function hyperMentionText(value: string): string { return hyperParseMentions(value).map(part => part.kind === 'text' ? part.text : '@' + part.person.name).join(''); }
export function hyperMentionPeople(value: string): HyperMention[] {
  return [...new Map(hyperParseMentions(value).flatMap(part => part.kind === 'mention' ? [[part.person.email, part.person] as const] : [])).values()];
}
export function hyperMentionQuery(value: string, caret: number) {
  const before = value.slice(0, caret); const match = /(?:^|[\s([{])@([^@\n\r[\]()]{2,128})$/u.exec(before);
  return match && match[1].trim().length >= 2 ? { query: match[1].trim(), start: before.length - match[1].length - 1, end: caret } : null;
}
export function hyperMentionDeletion(value: string, start: number, end: number, backwards: boolean) {
  if (start === end) { if (backwards) start--; else end++; }
  for (const part of hyperParseMentions(value)) if (part.kind === 'mention' && start < part.end && end > part.start) { start = Math.min(start, part.start); end = Math.max(end, part.end); }
  start = Math.max(0, start); end = Math.min(value.length, end);
  return { value: value.slice(0, start) + value.slice(end), caret: start };
}
export function hyperPersonStub(person: HyperMention): HyperPerson { return { ...person, title: '', department: '', phone: '', office: '', company: '', source: 'ad' }; }
