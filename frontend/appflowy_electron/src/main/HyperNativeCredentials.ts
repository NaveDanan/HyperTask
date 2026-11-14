import { dialog, ipcMain, type BrowserWindow } from 'electron';
import type { HyperOpenBotSession } from './HyperOpenBotSession';
import { hyperTunnelFetch } from './HyperOpenBotTunnel';
import type { HyperCallbackKeyResult } from '@shared/api';

/** Credentials never leave this main-owned dialog flow, including on transport failures. */
export function registerHyperNativeCredentials(window: () => BrowserWindow | null, sessions: HyperOpenBotSession, ready: () => boolean) {
  let busy = false;
  ipcMain.handle('hyper-openbot:callback-key', async (event, input: unknown): Promise<HyperCallbackKeyResult> => {
    const owner = window();
    if (!owner || owner.isDestroyed() || event.sender !== owner.webContents || event.senderFrame !== event.sender.mainFrame || busy || !ready()) return { status: 'refused' };
    if (!input || typeof input !== 'object' || Object.keys(input).sort().join(',') !== 'action,agentId') return { status: 'refused' };
    const { action, agentId } = input as Record<string, unknown>;
    if (typeof action !== 'string' || !['create', 'rotate', 'revoke'].includes(action) || typeof agentId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(agentId)) return { status: 'refused' };
    busy = true;
    const controller = new AbortController();
    const stop = () => controller.abort();
    const deadline = setTimeout(stop, 5 * 60 * 1000);
    event.sender.once('destroyed', stop);
    event.sender.once('render-process-gone', stop);
    event.sender.once('did-start-navigation', stop);
    const unsubscribe = sessions.onInvalidate(stop);
    try {
      const lease = await sessions.acquire();
      const check = async () => {
        controller.signal.throwIfAborted(); lease.assertCurrent();
        if (!ready() || window() !== owner || owner.isDestroyed() || event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame) throw new Error('Stopped');
        await sessions.acquire(); lease.assertCurrent(); controller.signal.throwIfAborted();
      };
      await check();
      const confirmation = await dialog.showMessageBox(owner, { type: 'warning', title: 'HyperTask callback key', message: `${action === 'revoke' ? 'Revoke' : action === 'rotate' ? 'Rotate' : 'Create'} callback key for Bot ${agentId}?`, detail: 'Rotation invalidates the previous key. The new key will be shown once in a native dialog. Anyone with this key can act as this Bot.', buttons: ['Cancel', 'Continue'], defaultId: 0, cancelId: 0, signal: controller.signal });
      await check();
      if (confirmation.response !== 1) return { status: 'cancelled' };
      const response = await hyperTunnelFetch(`/api/agents/${agentId}/callback-token`, { method: action === 'revoke' ? 'DELETE' : 'POST', signal: controller.signal, lease, headers: { origin: 'http://127.0.0.1:3010', 'content-type': 'application/json' } });
      await check();
      if (action === 'revoke') { await response.body?.cancel(); return { status: response.status === 204 ? 'revoked' : 'failed' }; }
      if (response.status !== 201) { await response.body?.cancel(); return { status: 'failed' }; }
      // Bound the one-time response before decoding it. No backend error text crosses IPC.
      const reader = response.body?.getReader();
      if (!reader) return { status: 'failed' };
      let body = '';
      try { for (;;) { const part = await reader.read(); if (part.done) break; if (body.length + part.value.length > 4096) throw new Error('Invalid key response'); body += Buffer.from(part.value).toString('utf8'); } } finally { await reader.cancel(); }
      let value: unknown; try { value = JSON.parse(body); } finally { body = ''; }
      if (!value || typeof value !== 'object' || !('token' in value) || typeof value.token !== 'string' || !/^obot_agt_[A-Za-z0-9_-]{43}$/.test(value.token)) return { status: 'failed' };
      await check();
      await dialog.showMessageBox(owner, { type: 'info', title: 'HyperTask one-time callback key', message: 'Record this key now. It cannot be shown again.', detail: value.token, buttons: ['Done'], signal: controller.signal });
      value = null;
      await check();
      return { status: 'issued' };
    } catch { return { status: 'failed' }; }
    finally { clearTimeout(deadline); busy = false; unsubscribe(); event.sender.removeListener('destroyed', stop); event.sender.removeListener('render-process-gone', stop); event.sender.removeListener('did-start-navigation', stop); }
  });
}
