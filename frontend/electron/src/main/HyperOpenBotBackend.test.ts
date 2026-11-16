import { expect, it } from 'vitest';
import { hyperParseBackendReport, hyperRunBackend } from './HyperOpenBotBackend';
import { HYPER_OPENBOT_CHECKS } from '@shared/HyperOpenBotService';
const ready = () => ({ version: 1, ready: true, problem: 'none', checks: HYPER_OPENBOT_CHECKS.map(id => ({ id, state: 'ready' })) });
it('accepts only a complete, consistent, secret-free readiness report', () => {
  expect(hyperParseBackendReport(JSON.stringify(ready())).ready).toBe(true);
  for (const value of [{ ...ready(), token: 'not-a-real-secret' }, { ...ready(), checks: [] }, { ...ready(), ready: false }, { ...ready(), checks: HYPER_OPENBOT_CHECKS.map(() => ({ id: 'docker', state: 'ready' })) }])
    expect(() => hyperParseBackendReport(JSON.stringify(value))).toThrow();
});
it('rejects command injection before attempting SSH', async () => {
  await expect(hyperRunBackend('start; touch /tmp/forbidden' as never, new AbortController().signal)).rejects.toThrow('operation_failed');
});
