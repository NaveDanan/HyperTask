import { expect, it } from 'vitest';
import { HyperVoiceBroker } from './HyperVoiceBroker';
it('keeps credentials in main and binds one-use handles to their renderer', () => {
  const broker = new HyperVoiceBroker();
  const result = broker.sanitize({ transport: 'websocket', url: 'wss://api.x.ai/v1/realtime', clientSecret: 'private', session: { modalities: ['audio'] } }, 1);
  expect(JSON.stringify(result)).not.toContain('private');
  const path = new URL(result.url as string).pathname;
  expect(() => broker.take(path, 2)).toThrow();
  expect(broker.take(path, 1)).toEqual({ secret: 'private', destination: 'wss://api.x.ai/v1/realtime' });
  expect(() => broker.take(path, 1)).toThrow();
  expect(() => broker.sanitize({ transport: 'websocket', url: 'wss://evil/v1/realtime', clientSecret: 'private', session: {} }, 1)).toThrow();
});
it('revokes pending voice handles at the authenticated session boundary', () => {
  const broker = new HyperVoiceBroker(); const session = new AbortController();
  const result = broker.sanitize({ transport: 'websocket', url: 'wss://api.x.ai/v1/realtime', clientSecret: 'private', session: {} }, 1, session.signal);
  session.abort(); expect(() => broker.take(new URL(result.url as string).pathname, 1)).toThrow();
});
it('preserves the original model query in main while refusing other destinations and query parameters', () => {
  const broker = new HyperVoiceBroker();
  const destination = 'wss://api.x.ai/v1/realtime?model=grok-voice';
  const result = broker.sanitize({ transport: 'websocket', url: destination, clientSecret: 'synthetic-key', session: {} }, 1);
  expect(broker.take(new URL(result.url as string).pathname, 1)).toEqual({ secret: 'synthetic-key', destination });
  for (const url of ['wss://api.x.ai/v1/realtime?token=secret', 'wss://api.x.ai/v1/realtime?model=a&model=b', 'wss://user:pass@api.x.ai/v1/realtime', 'wss://api.x.ai:1234/v1/realtime', 'wss://api.x.ai/v1/realtime#fragment', 'wss://api.x.ai.evil/v1/realtime']) {
    expect(() => broker.sanitize({ transport: 'websocket', url, clientSecret: 'synthetic-key', session: {} }, 1)).toThrow('Invalid voice configuration');
  }
});
it('returns only the WebRTC SDP contract and rejects unknown transports', () => {
  const broker = new HyperVoiceBroker();
  expect(broker.sanitize({ transport: 'webrtc', sdp: 'answer', clientSecret: 'must-not-cross-ipc' }, 1)).toEqual({ transport: 'webrtc', sdp: 'answer' });
  expect(() => broker.sanitize({ transport: 'other', clientSecret: 'must-not-cross-ipc' }, 1)).toThrow('Invalid voice configuration');
});
