import type { HyperAssistantConfirmedPerson } from './HyperAssistant';
import { hyperFindPlainPersonSpan, hyperParseMentions, hyperSerializeMention } from './HyperPeopleMentions';

/** Use the confirmed source ranges before applying any text edits. */
export function hyperApplyConfirmedPeople(text: string, people: readonly HyperAssistantConfirmedPerson[], preview = false): string {
  const replacements: { start: number; end: number; token: string }[] = [];
  const extraPeople: HyperAssistantConfirmedPerson[] = [];
  const mentions = hyperParseMentions(text).filter((part) => part.kind === 'mention');
  const ordered = [...people.filter((person) => person.sourceSpan), ...people.filter((person) => !person.sourceSpan)];
  for (const person of ordered) {
    const token = hyperSerializeMention(person);
    const rawName = person.rawName?.trim();
    const span = person.sourceSpan ??
      mentions.find((part) => part.person.name.toLowerCase() === (rawName || person.name).toLowerCase()) ??
      hyperFindPlainPersonSpan(text, rawName || person.name) ??
      (rawName ? hyperFindPlainPersonSpan(text, person.name) : undefined);
    const claimed = span && replacements.some((part) => span.start < part.end && span.end > part.start);
    if (!span || claimed) {
      extraPeople.push(person);
      continue;
    }
    const pad = span.start > 0 && /[\p{L}\p{M}]/u.test(text[span.start - 1]!) ? ' ' : '';
    replacements.push({ start: span.start, end: span.end, token: pad + token });
  }

  let body = text;
  for (const { start, end, token } of replacements.sort((a, b) => b.start - a.start)) {
    body = body.slice(0, start) + token + body.slice(end);
  }
  if (!extraPeople.length) return body;
  const included = new Set(hyperParseMentions(body).flatMap((part) => part.kind === 'mention' ? [part.person.email] : []));
  const extras: string[] = [];
  for (const person of extraPeople) {
    const email = person.email.toLowerCase();
    if (included.has(email)) continue;
    included.add(email);
    extras.push(hyperSerializeMention(person));
  }
  if (!extras.length) return body;
  if (!body) return extras.join(', ');
  return preview ? body + ' · ' + extras.join(', ') : body + ' (' + extras.join(', ') + ')';
}
