import { HYPER_OPENBOT_ORIGIN, hyperOpenBotFetch } from './transport';
import { HyperOpenBotSocket, hyperSocketPath } from './socket';
let users = 0;
let restore: (() => void) | undefined;
export function acquireHyperOpenBotTransport() {
  if (users++ === 0) {
    const originalFetch = globalThis.fetch;
    const OriginalSocket = globalThis.WebSocket;
    const wrappedFetch: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url.startsWith(`${HYPER_OPENBOT_ORIGIN}/`) ? hyperOpenBotFetch(input, init) : originalFetch(input, init);
    };
    const WrappedSocket = new Proxy(OriginalSocket, { construct(target, args) { return hyperSocketPath(String(args[0])) ? new HyperOpenBotSocket(args[0], args[1]) : Reflect.construct(target, args); } });
    globalThis.fetch = wrappedFetch; globalThis.WebSocket = WrappedSocket;
    restore = () => { if (globalThis.fetch === wrappedFetch) globalThis.fetch = originalFetch; if (globalThis.WebSocket === WrappedSocket) globalThis.WebSocket = OriginalSocket; };
  }
  let released = false;
  return () => { if (released) return; released = true; if (--users === 0) { restore?.(); restore = undefined; } };
}
