import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { HyperOpenBotServiceState } from '@shared/HyperOpenBotService';
import { HyperServiceStatus } from './HyperServiceStatus';

const stopped: HyperOpenBotServiceState = { backend: 'mmems-personal', phase: 'idle', ready: false, problem: 'services_stopped', checks: [], autoStart: false, checkedAt: '2026-11-14T00:00:00Z' };
function stopDisabled(state: HyperOpenBotServiceState) {
  const html = renderToStaticMarkup(<HyperServiceStatus state={state} />);
  const button = html.match(/<button\b[^>]*>Stop AI services<\/button>/)?.[0];
  expect(button).toBeDefined();
  return /\sdisabled(?:=|[\s>])/.test(button!);
}
it('allows stopping the remaining Intelligence node or an unhealthy managed service', () => {
  expect(stopDisabled({ ...stopped, checks: [{ id: 'deployment', state: 'ready' }, { id: 'server', state: 'stopped' }] })).toBe(false);
  expect(stopDisabled({ ...stopped, checks: [{ id: 'deployment', state: 'stopped' }, { id: 'computer', state: 'unhealthy' }] })).toBe(false);
  expect(stopDisabled(stopped)).toBe(true);
  expect(stopDisabled({ ...stopped, phase: 'stopping', checks: [{ id: 'deployment', state: 'ready' }] })).toBe(true);
});
