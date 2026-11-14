import { beforeEach, expect, it, vi } from 'vitest';
import { hyperOpenBotRequest } from '../transport';
import { HyperMayOpenSetup, HyperReadSetup, HyperRecheckSetup, HyperSaveOnboarding, HyperSaveOnboardingName } from './HyperOnboardingApi';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
beforeEach(() => vi.mocked(hyperOpenBotRequest).mockReset());
it('reads and rechecks the server checklist', async () => {
  vi.mocked(hyperOpenBotRequest).mockResolvedValue({ checklist: { audience: 'admin', rows: [] } });
  expect(await HyperReadSetup()).toEqual({ audience: 'admin', rows: [] });
  await HyperRecheckSetup();
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/setup/check', 'POST');
  expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/setup');
});
it('saves stable step numbers and completion then reads the user', async () => {
  vi.mocked(hyperOpenBotRequest).mockResolvedValue({ user: null });
  await HyperSaveOnboarding({ step: 3 });
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/me/onboarding', 'POST', { step: 3 });
  await HyperSaveOnboarding({ completed: true });
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/me/onboarding', 'POST', { completed: true });
  expect(hyperOpenBotRequest).toHaveBeenLastCalledWith('/api/me');
});
it('validates and trims names without sending invalid input', async () => {
  await expect(HyperSaveOnboardingName('  ')).rejects.toThrow('Enter a name');
  expect(hyperOpenBotRequest).not.toHaveBeenCalled();
  vi.mocked(hyperOpenBotRequest).mockResolvedValue({ user: null });
  await HyperSaveOnboardingName(' Ada ');
  expect(hyperOpenBotRequest).toHaveBeenCalledWith('/api/me/profile', 'PATCH', { name: 'Ada' });
});
it('does not grant setup without a server role or local evaluation', () => {
  expect(HyperMayOpenSetup(null)).toBe(false);
  expect(HyperMayOpenSetup(null, { localEvaluation: true })).toBe(true);
});
it('preserves refused writes', async () => {
  vi.mocked(hyperOpenBotRequest).mockRejectedValue(new Error('403'));
  await expect(HyperSaveOnboarding({ completed: true })).rejects.toThrow('403');
});
