import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
import { hyperOpenBotRequest } from '../transport';
import { hyperBrowserAction, hyperReadBrowser, hyperTakeControl, hyperReleaseControl } from './HyperComputerApi';
import { hyperComputerSocketPathAllowed } from './HyperComputerSocketPolicy';
const request = vi.mocked(hyperOpenBotRequest);
beforeEach(() => request.mockReset());
it('uses personal and Bot browser endpoints with upstream payloads', async () => {
  await hyperReadBrowser(); await hyperReadBrowser('bot id');
  await hyperBrowserAction('bot', 'navigate', { url: 'https://example.com' });
  await hyperBrowserAction(undefined, 'recording', { action: 'start', title: 'Task', narrate: false });
  expect(request.mock.calls).toEqual([
    ['/api/browser'], ['/api/computers/bot%20id/browser'],
    ['/api/computers/bot/browser/navigate', 'POST', { url: 'https://example.com' }],
    ['/api/browser/recording', 'POST', { action: 'start', title: 'Task', narrate: false }],
  ]);
});
it('requests a durable manual handoff before taking control', async () => {
  request.mockResolvedValueOnce({ request: { id: 'request' } }).mockResolvedValueOnce({ holder: 'human' });
  await hyperTakeControl('bot'); await hyperReleaseControl('bot', 'request');
  expect(request.mock.calls).toEqual([
    ['/api/computers/bot/control/request', 'POST', { reason: 'I want to take control of the browser.', source: 'manual' }],
    ['/api/computers/bot/control/take', 'POST', { requestId: 'request' }],
    ['/api/computers/bot/control/release', 'POST', { requestId: 'request' }],
  ]);
});
it('refuses a take when no request was granted', async () => { request.mockResolvedValueOnce({ holder: 'bot' }); await expect(hyperTakeControl('bot')).rejects.toThrow('did not grant'); expect(request).toHaveBeenCalledTimes(1); });
it('allows only exact computer stream endpoints', () => {
  for (const path of ['/api/computers/bot-1/stream', '/api/computers/person_a/terminal']) expect(hyperComputerSocketPathAllowed(path)).toBe(true);
  for (const path of ['/api/computers/../stream', '/api/computers/b%2fo/stream', '/api/computers/a/stream?token=x', '/api/computers/a/stream/extra', '/api/recorder/stream', '/api/computers/a\\b/terminal']) expect(hyperComputerSocketPathAllowed(path)).toBe(false);
});
