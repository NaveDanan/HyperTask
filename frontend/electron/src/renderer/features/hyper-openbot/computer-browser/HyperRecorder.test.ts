import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
vi.mock('./HyperRecorderBridge', () => ({ sendConnectCode: vi.fn(), findRecorderHere: vi.fn(), sendRecorderPage: vi.fn(), askConnectWait: vi.fn(), connectRefusalSentence: () => 'Connection refused.', CONFIRM_WINDOW_MS: 300000 }));
import { hyperOpenBotRequest } from '../transport';
import { sendConnectCode } from './HyperRecorderBridge';
import { hyperConnectRecorder, hyperReadRecordings, hyperRefreshRecordings } from './HyperRecorder';
import { hyperSupplyComputerSecret } from './HyperPrivateHandoffs';
import { hyperOpenBotComputer } from './HyperComputerDestination';
const request = vi.mocked(hyperOpenBotRequest);
beforeEach(() => { vi.clearAllMocks(); });
it('paginates recording history with the server cursor encoded exactly once', async () => {
  await hyperReadRecordings(); await hyperReadRecordings('a/b?next=1');
  expect(request.mock.calls).toEqual([['/api/recorder/recordings'], ['/api/recorder/recordings?cursor=a%2Fb%3Fnext%3D1']]);
});
it('hands a short lived connect code only to the discovered extension and surfaces refusal', async () => {
  request.mockResolvedValueOnce({ code: 'test-connect-code' }); vi.mocked(sendConnectCode).mockResolvedValueOnce({ ok: true, awaitingConfirmation: true });
  expect(await hyperConnectRecorder('extension')).toEqual({ ok: true, awaitingConfirmation: true });
  expect(request).toHaveBeenCalledWith('/api/recorder/connect-codes', 'POST', { via: 'web' }); expect(sendConnectCode).toHaveBeenCalledWith('extension', 'test-connect-code');
  request.mockResolvedValueOnce({ code: 'second-code' }); vi.mocked(sendConnectCode).mockResolvedValueOnce({ ok: false, error: 'throttled' }); await expect(hyperConnectRecorder('extension')).rejects.toThrow('Connection refused.');
});
it('sends a private secret in a body and never echoes a refused response', async () => {
  request.mockRejectedValueOnce(new Error('sensitive remote response'));
  await expect(hyperSupplyComputerSecret('bot id', 'test-only-value')).rejects.toThrow('The value could not be entered. Retype it and try again.');
  expect(request).toHaveBeenCalledWith('/api/computers/bot%20id/human/secret', 'POST', { text: 'test-only-value' });
});
it('uses the same native computer destination from typed browser callbacks', () => {
  const navigate = vi.fn(); hyperOpenBotComputer('bot', navigate); expect(navigate).toHaveBeenCalledWith('bot-computer');
});

it('preserves all loaded history when an earlier cursor page becomes unavailable', async () => {
  const row = (id: string) => ({ id, title: id, recordedAt: '2026-11-15', ended: 'stopped', reason: null });
  request.mockResolvedValueOnce({ recordings: [], nextCursor: null, unavailable: 'unreachable' });
  const pages = await hyperRefreshRecordings([{ recordings: [row('first')], nextCursor: 'second' }, { recordings: [row('second')], nextCursor: null }]);
  expect(pages.map(page => page.recordings.map(row => row.id))).toEqual([['first'], ['second']]); expect(pages[0].unavailable).toBe('unreachable');
});
it('recovers every loaded recording page after a first-page outage', async () => {
  const row = (id: string) => ({ id, title: id, recordedAt: '2026-11-15', ended: 'stopped', reason: null });
  const initial = [{ recordings: [row('first')], nextCursor: 'second' }, { recordings: [row('second')], nextCursor: null }];
  request.mockResolvedValueOnce({ recordings: [], nextCursor: null, unavailable: 'unreachable' });
  const unavailable = await hyperRefreshRecordings(initial);
  request.mockResolvedValueOnce(initial[0]).mockResolvedValueOnce(initial[1]);
  const recovered = await hyperRefreshRecordings(unavailable);
  expect(recovered.map(page => page.recordings.map(item => item.id))).toEqual([['first'], ['second']]);
  expect(request.mock.calls.slice(-2)).toEqual([['/api/recorder/recordings'], ['/api/recorder/recordings?cursor=second']]);
});
