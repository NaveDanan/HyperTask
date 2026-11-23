import type { HyperPerson } from '@shared/api';
import { hyperParseMentions, type HyperMention } from '@shared/HyperPeopleMentions';
export { hyperParseMentions, hyperSerializeMention, type HyperMention, type HyperMentionPart } from '@shared/HyperPeopleMentions';
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
