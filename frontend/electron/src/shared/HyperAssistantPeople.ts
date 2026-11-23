import type { HyperAssistantConfirmedPerson, HyperAssistantPersonSlot } from './HyperAssistant';
import { hyperFindPlainPersonSpan, hyperParseMentions, hyperSerializeMention } from './HyperPeopleMentions';

const personSeparator = /^(?:\s*,(?:\s*(?:and|&|ו[למב]?))?|\s+(?:and|&|ו[למב]?))\s*$/iu;

export function hyperRemoveAssistantPerson(text: string, slots: readonly HyperAssistantPersonSlot[], slotId: string) {
  const span = slots.find((slot) => slot.id === slotId)?.sourceSpan;
  const remaining = slots.filter((slot) => slot.id !== slotId);
  if (!span || text.slice(span.start, span.end) !== span.text) return { text, people: remaining };

  let { start, end } = span;
  const otherSpans = remaining.flatMap((slot) => slot.sourceSpan ? [slot.sourceSpan] : []);
  const next = otherSpans.find((other) => other.start >= end && personSeparator.test(text.slice(end, other.start)));
  const previous = otherSpans.find((other) => other.end <= start && personSeparator.test(text.slice(other.end, start)));
  if (previous) start = previous.end;
  else if (next) end = next.start;

  const before = text.slice(0, start);
  const after = text.slice(end);
  const whitespace = before.endsWith(' ') ? after.length - after.trimStart().length : 0;
  const joined = before + after.slice(whitespace);
  const leading = joined.length - joined.trimStart().length;
  const people = remaining.map((slot) => {
    const sourceSpan = slot.sourceSpan;
    if (!sourceSpan) return slot;
    const shift = leading + (sourceSpan.start >= end ? end - start + whitespace : 0);
    return {
      ...slot,
      sourceSpan: { ...sourceSpan, start: sourceSpan.start - shift, end: sourceSpan.end - shift },
    };
  });
  return { text: joined.trim(), people };
}

/** Use the confirmed source ranges before applying any text edits. */
export function hyperApplyConfirmedPeople(text: string, people: readonly HyperAssistantConfirmedPerson[], preview = false): string {
  const replacements: { start: number; end: number; token: string }[] = [];
  const extraPeople: HyperAssistantConfirmedPerson[] = [];
  const mentions = hyperParseMentions(text).filter((part) => part.kind === 'mention');
  const ordered = [...people.filter((person) => person.sourceSpan), ...people.filter((person) => !person.sourceSpan)];
  for (const person of ordered) {
    const token = hyperSerializeMention(person);
    const rawName = person.rawName?.trim();
    const isClaimed = (span: { start: number; end: number }) =>
      replacements.some((part) => span.start < part.end && span.end > part.start);
    const email = person.email.toLowerCase();
    const span = person.sourceSpan ??
      mentions.find((part) => part.person.email === email && !isClaimed(part)) ??
      hyperFindPlainPersonSpan(text, rawName || person.name, replacements) ??
      (rawName ? hyperFindPlainPersonSpan(text, person.name, replacements) : undefined);
    if (!span || isClaimed(span)) {
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
