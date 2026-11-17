import { afterEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ creates: vi.fn(), starts: vi.fn(), stops: vi.fn() }));
vi.mock('@/features/sidebar/stores/space-store', () => ({ sidebarSpace: { actions: { workspaceId: '' }, store: { getState: () => ({ isInitialized: false }) } } }));
vi.mock('@/features/hyper-home/HyperGeneralKanban', () => ({ ensureHyperGeneralKanban: vi.fn() }));
vi.mock('./jira-store', () => ({ createHyperJiraStore: fake.creates.mockImplementation(() => ({ getState: () => ({}) })) }));
vi.mock('./HyperJiraScheduler', () => ({ startHyperJiraScheduler: fake.starts.mockImplementation(() => fake.stops) }));
import { getHyperJiraStore, startHyperJiraBackgroundSync } from './HyperJiraRegistry';
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('shares one store and scheduler per user, reference counts owners and stops on sign-out/switch', () => {
  vi.stubGlobal('window', new EventTarget());
  const first = getHyperJiraStore('registry-first');
  expect(getHyperJiraStore('registry-first')).toBe(first); expect(fake.creates).toHaveBeenCalledTimes(1);
  const stop1 = startHyperJiraBackgroundSync('registry-first'), stop2 = startHyperJiraBackgroundSync('registry-first');
  expect(fake.starts).toHaveBeenCalledTimes(1); stop1(); expect(fake.stops).not.toHaveBeenCalled();
  stop2(); stop2(); expect(fake.stops).toHaveBeenCalledTimes(1);
  expect(getHyperJiraStore('registry-second')).not.toBe(first);
  const stop3 = startHyperJiraBackgroundSync('registry-second'); expect(fake.starts).toHaveBeenCalledTimes(2); stop3();
  expect(fake.stops).toHaveBeenCalledTimes(2);
});
