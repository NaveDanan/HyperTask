import { expect, it } from 'vitest';
import { HyperVoiceBroker } from './HyperVoiceBroker';
it('keeps credentials in main and binds one-use handles to their renderer', () => {
  const broker = new HyperVoiceBroker();
  const result = broker.sanitize({ transport: 'websocket', url: 'wss://api.x.ai/v1/realtime', clientSecret: 'private', session: { modalities: ['audio'] } }, 1);
  expect(JSON.stringify(result)).not.toContain('private');
  const path = new URL(result.url as string).pathname;
  expect(() => broker.take(path, 2)).toThrow();
  expect(broker.take(path, 1)).toBe('private');
  expect(() => broker.take(path, 1)).toThrow();
  expect(() => broker.sanitize({ transport: 'websocket', url: 'wss://evil/v1/realtime', clientSecret: 'private', session: {} }, 1)).toThrow();
});
it('revokes pending voice handles at the authenticated session boundary', () => {
  const broker = new HyperVoiceBroker(); const session = new AbortController();
  const result = broker.sanitize({ transport: 'websocket', url: 'wss://api.x.ai/v1/realtime', clientSecret: 'private', session: {} }, 1, session.signal);
  session.abort(); expect(() => broker.take(new URL(result.url as string).pathname, 1)).toThrow();
});
