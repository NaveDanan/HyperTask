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
import { HYPER_OPENBOT_SERVICE_MESSAGES } from '@shared/HyperOpenBotService';

it.each(['unsupported', 'signed_out', 'profile_required'] as const)('shows %s instead of checking when no readiness timestamp exists', (problem) => {
  const html = renderToStaticMarkup(<HyperServiceStatus state={{ ...stopped, checkedAt: null, problem }} />);
  expect(html).toContain(HYPER_OPENBOT_SERVICE_MESSAGES[problem]);
  expect(html).not.toContain('Checking AI services');
  expect(html).not.toContain('Checking OpenBot services');
  expect(html).not.toContain('Checking the configured private backend');
});

it('explains that OpenBot readiness is separate from the configured LLM endpoint', () => {
  const html = renderToStaticMarkup(<HyperServiceStatus state={{ ...stopped, problem: 'unsupported', checkedAt: null }} />);
  expect(html).toContain('Settings → Connections → AI endpoint');
  expect(html).toContain('Manage the workspace AI endpoint separately');
});
