import { expect, it } from 'vitest';
import { HyperNodSseParser, hyperNodEvent } from './HyperNodSse';
const THREAD = '11111111-1111-4111-8111-111111111111';
const TURN = '22222222-2222-4222-8222-222222222222';
const bytes = (text: string) => new TextEncoder().encode(text);
function feed(parts: readonly Uint8Array[]) {
  const parser = new HyperNodSseParser();
  return parts.flatMap(part => parser.push(part));
}
it('splits events at every byte boundary, including UTF-8 sequences and CRLF pairs', () => {
  const stream = bytes(`: keepalive\r\n\r\ndata: {"type":"delta","text":"שלום 👋"}\r\n\r\ndata: {"type":"refresh"}\n\n`);
  for (let at = 1; at < stream.length; at++) expect(feed([stream.slice(0, at), stream.slice(at)])).toEqual(['{"type":"delta","text":"שלום 👋"}', '{"type":"refresh"}']);
  expect(feed([...stream].map(byte => Uint8Array.of(byte)))).toHaveLength(2);
});
it('joins multiple data lines, skips comments and other fields, and waits for the blank line', () => {
  const parser = new HyperNodSseParser();
  expect(parser.push(bytes('event: x\nid: 7\ndata: one\ndata:two\ndata\n'))).toEqual([]);
  expect(parser.push(bytes('\n'))).toEqual(['one\ntwo\n']);
  expect(parser.push(bytes(': comment\n\n\n'))).toEqual([]);
  expect(parser.push(bytes('data: tail'))).toEqual([]);
});
it('treats a lone carriage return as a line end once the next byte is known', () => {
  const parser = new HyperNodSseParser();
  expect(parser.push(bytes('data: a\r'))).toEqual([]);
  expect(parser.push(bytes('\rdata: b\r\r'))).toEqual(['a']);
  expect(parser.push(bytes('x'))).toEqual(['b']);
});
it('refuses an event or a line larger than 1 MiB', () => {
  expect(() => new HyperNodSseParser().push(bytes(`data: ${'x'.repeat(1024 * 1024 + 1)}\n`))).toThrow('larger than 1 MiB');
  expect(() => new HyperNodSseParser().push(bytes('x'.repeat(1024 * 1024 + 1)))).toThrow('larger than 1 MiB');
  const parser = new HyperNodSseParser();
  parser.push(bytes(`data: ${'x'.repeat(600 * 1024)}\n`));
  expect(() => parser.push(bytes(`data: ${'x'.repeat(600 * 1024)}\n`))).toThrow('larger than 1 MiB');
});
it('normalizes deltas and turns unknown or malformed events into a refresh', () => {
  expect(hyperNodEvent(JSON.stringify({ type: 'delta', threadId: THREAD, turnId: TURN, text: 'Hi', extra: 1 }))).toEqual({ type: 'delta', threadId: THREAD, turnId: TURN, text: 'Hi', streamId: null, done: false });
  expect(hyperNodEvent(JSON.stringify({ type: 'delta', threadId: THREAD, turnId: TURN, text: '', streamId: 's1', done: true }))).toMatchObject({ streamId: 's1', done: true });
  expect(hyperNodEvent(JSON.stringify({ type: 'activity', items: [{ turnId: TURN, title: null, step: 'Reading', doing: 'tool', site: 'x', since: 'now', quietSince: 'now', tool: 'browser' }] })))
    .toEqual({ type: 'activity', items: [{ turnId: TURN, title: null, step: 'Reading', doing: 'tool', tool: 'browser' }] });
  for (const data of ['not json', '{"type":"future"}', JSON.stringify({ type: 'delta', threadId: 'x', turnId: TURN, text: 'a' })]) expect(hyperNodEvent(data)).toEqual({ type: 'refresh' });
});
