// window.appflowy for a normal browser, bridged to scripts/web-harness/server.cjs.
(() => {
  const encode = (value) =>
    JSON.stringify(value, (_k, v) => {
      if (typeof v === 'bigint') return { __bigint: v.toString() };
      if (v instanceof Uint8Array) {
        let binary = '';
        for (let i = 0; i < v.length; i++) binary += String.fromCharCode(v[i]);
        return { __bytes: btoa(binary) };
      }
      return v;
    });
  const decode = (text) =>
    JSON.parse(text, (_k, v) => {
      if (v && typeof v === 'object' && '__bigint' in v) return BigInt(v.__bigint);
      if (v && typeof v === 'object' && '__bytes' in v) {
        const binary = atob(v.__bytes);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }
      return v;
    });

  const rpc = async (method, ...args) => {
    const response = await fetch('/__harness/rpc', { method: 'POST', body: encode({ method, args }) });
    const reply = decode(await response.text());
    if (!reply.ok) throw new Error(reply.error);
    return reply.result;
  };

  const listeners = { notification: new Set(), port: new Set(), coreExit: new Set(), maximized: new Set() };
  const events = new EventSource('/__harness/events');
  events.onmessage = (message) => {
    const event = decode(message.data);
    if (event.type === 'notification') listeners.notification.forEach((l) => l(event.payload));
    if (event.type === 'port') listeners.port.forEach((l) => l(event.port, event.value));
    if (event.type === 'coreExit') listeners.coreExit.forEach((l) => l(event.code));
  };
  const on = (set, listener) => {
    set.add(listener);
    return () => set.delete(listener);
  };

  // Calls the harness does not implement resolve to null (or do nothing).
  const fallback = (namespace) =>
    new Proxy({}, { get: (_t, name) => (...args) => rpc(`${namespace}.${String(name)}`, ...args).catch(() => null) });

  const api = {
    core: {
      init: (config) => rpc('core.init', config),
      request: (event, payload) => rpc('core.request', event, payload),
      log: (level, message) => void rpc('core.log', level, message),
      onNotification: (listener) => on(listeners.notification, listener),
      onPortMessage: (listener) => on(listeners.port, listener),
      onExit: (listener) => on(listeners.coreExit, listener),
    },
    app: Object.assign(fallback('app'), {
      relaunch: () => location.reload(),
      setZoomFactor: (factor) => (document.body.style.zoom = String(factor)),
      registerDeepLinkScheme: () => {},
      onDeepLink: () => () => {},
      getStartup: async () => ({ enabled: false, available: false, reason: 'Available in the installed desktop app.' }),
    }),
    clipboard: { writeText: (text) => void navigator.clipboard?.writeText(text).catch(() => {}), readText: async () => '' },
    window: {
      minimize() {},
      toggleMaximize() {},
      close() {},
      isMaximized: async () => false,
      onMaximizedChange: (listener) => on(listeners.maximized, listener),
      setFullScreen() {},
    },
    // Rejects like the IPC call so callers see network failures.
    net: { request: (options) => rpc('net.request', options) },
    shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {} },
    dialog: { pickDirectory: async () => null, pickFiles: async () => [], saveFile: async () => null },
  };
  window.appflowy = new Proxy(api, { get: (target, name) => (name in target ? target[name] : fallback(String(name))) });
})();
