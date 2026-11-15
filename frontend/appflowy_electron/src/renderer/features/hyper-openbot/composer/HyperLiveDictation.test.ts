import { afterEach, expect, it, vi } from 'vitest';
import { HyperLiveDictation, transcriptOf, liveProblem } from './HyperLiveDictation';
import type { Recognition } from '../computer-browser/HyperNarration';
afterEach(() => vi.useRealTimers());
it('rebuilds interim words, waits for stop, and rejects late words after cancellation', async () => {
  vi.useFakeTimers(); let recognition!: Recognition;
  class Fake {
    lang = ''; continuous = false; interimResults = false; maxAlternatives = 1;
    onresult: Recognition['onresult'] = null; onerror: Recognition['onerror'] = null; onend: Recognition['onend'] = null;
    start = vi.fn(); stop = vi.fn(); abort = vi.fn();
    constructor() { recognition = this as unknown as Recognition; }
  }
  const text = vi.fn(); const session = new HyperLiveDictation({ source: () => ({ Recognition: Fake as any, platform: 'browser' }), language: () => 'en-US', onStart: vi.fn(), onText: text });
  await session.start(); const late = recognition.onresult!; session.stop(); expect(session.getSnapshot().phase).toBe('stopping');
  const event = { resultIndex: 0, results: [{ 0: { transcript: ' Hello ' }, length: 1, isFinal: false }] };
  late(event); expect(text).toHaveBeenLastCalledWith('Hello'); session.release(); late(event); expect(text).toHaveBeenCalledTimes(1);
  expect(session.active).toBe(false);
});
it('joins all phrases and treats silence as a normal finish', () => {
  expect(transcriptOf({ resultIndex: 1, results: [{ 0: { transcript: ' one ' }, length: 1, isFinal: true }, { 0: { transcript: 'two' }, length: 1, isFinal: false }] })).toBe('one two');
  expect(liveProblem('no-speech', 'browser')).toBeNull(); expect(liveProblem('not-allowed', 'browser')).toContain('blocked');
});
