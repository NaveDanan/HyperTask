import { beforeEach, expect, it, vi } from 'vitest';
import { hyperOpenBotRequest } from '../transport';
import { hyperReadDelivery, hyperStartChatLink, hyperStartSms, hyperConfirmSms, hyperRemoveBinding, hyperRemoveDevice } from './HyperDeliveryApi';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
const request = vi.mocked(hyperOpenBotRequest);
beforeEach(() => request.mockReset());
it('preserves delivery contracts and server challenge identity', async () => {
  await hyperReadDelivery(); expect(request).toHaveBeenLastCalledWith('/api/delivery');
  const target = { channelId: 'channel', agentId: 'bot', platform: 'teams' as const };
  await hyperStartChatLink(target); expect(request).toHaveBeenLastCalledWith('/api/delivery/opentag/start', 'POST', target);
  request.mockResolvedValueOnce({ challengeId: 'challenge' });
  const sms = { channelId: 'channel', agentId: 'bot', phone: '+15551234567' };
  expect(await hyperStartSms(sms)).toBe('challenge'); expect(request).toHaveBeenLastCalledWith('/api/delivery/sms/start', 'POST', sms);
  await hyperConfirmSms('challenge', 'code'); expect(request).toHaveBeenLastCalledWith('/api/delivery/sms/confirm', 'POST', { challengeId: 'challenge', code: 'code' });
  await hyperRemoveBinding('binding id'); expect(request).toHaveBeenLastCalledWith('/api/delivery/bindings/binding%20id', 'DELETE');
  await hyperRemoveDevice('device id'); expect(request).toHaveBeenLastCalledWith('/api/delivery/devices/device%20id', 'DELETE');
});
