import { expect, it, vi } from 'vitest';
import { connectScreen, type ScreenSocket } from './HyperScreenConnection';
function setup() {
  const sockets: ScreenSocket[] = []; const timers: (() => void)[] = [];
  const ready = vi.fn(); const problem = vi.fn(); const message = vi.fn();
  const ownership = vi.fn(async () => false);
  const connection = connectScreen({ open: () => { const socket = { onopen: null, onclose: null, onerror: null, onmessage: null, close: vi.fn() } as ScreenSocket; sockets.push(socket); return socket; }, verifyOwnership: ownership, onReady: ready, onProblem: problem, onDisconnect: vi.fn(), onMessage: message, schedule: run => { timers.push(run); return vi.fn(); } });
  return { sockets, timers, ready, problem, message, ownership, connection };
}
it('rechecks ownership after reconnect and ignores frames from the old viewer', async () => {
  const s = setup(); await s.sockets[0].onopen?.(); expect(s.ready).toHaveBeenLastCalledWith(true);
  s.sockets[0].onclose?.(); s.timers.shift()!(); await s.sockets[1].onopen?.();
  expect(s.ownership).toHaveBeenCalledOnce(); expect(s.ready).toHaveBeenLastCalledWith(false);
  s.sockets[0].onmessage?.({ data: '{"type":"frame"}' }); expect(s.message).not.toHaveBeenCalled(); s.connection.stop();
});
it('stops retrying when another viewer supersedes this one', () => {
  const s = setup(); s.sockets[0].onmessage?.({ data: '{"type":"error","error":"Opened elsewhere"}' });
  expect(s.sockets[0].close).toHaveBeenCalledOnce(); expect(s.problem).toHaveBeenCalledWith('Opened elsewhere'); expect(s.timers).toHaveLength(0);
});
it('bounds reconnect attempts and cancels further work after stop', () => {
  const s = setup(); for (let i = 0; i < 6; i++) { s.sockets[i].onclose?.(); s.timers.shift()?.(); }
  expect(s.sockets).toHaveLength(6); expect(s.problem).toHaveBeenCalledWith('The live screen is disconnected. Retry to reconnect.');
  s.connection.stop(); s.sockets[5].onmessage?.({ data: '{"type":"frame"}' }); expect(s.message).not.toHaveBeenCalled();
});
