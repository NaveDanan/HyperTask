import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
vi.mock('./HyperRecorderBridge', () => ({ sendConnectCode: vi.fn(), findRecorderHere: vi.fn(), sendRecorderPage: vi.fn(), askConnectWait: vi.fn(), connectRefusalSentence: () => 'Connection refused.', CONFIRM_WINDOW_MS: 300000 }));
import { hyperOpenBotRequest } from '../transport';
import { sendConnectCode } from './HyperRecorderBridge';
import { hyperConnectRecorder, hyperReadRecordings } from './HyperRecorder';
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
