// Adapted to native delivery from OpenBot responsibilities/trigger-routes.
// Copyright (c) 2026 CopilotKit. MIT; retain the original server contracts.
import { clipboard, dialog, type BrowserWindow } from 'electron';

/** Only these pinned routes can return generated/revealed trigger credentials. */
export function hyperTriggerSecretRequest(pathname: string, method: string): boolean {
  return (method === 'POST' && /^\/api\/responsibilities\/[^/]+\/triggers\/?$/.test(pathname)) ||
    (['GET', 'POST'].includes(method) && /^\/api\/responsibilities\/triggers\/[^/]+\/secret\/?$/.test(pathname));
}

export async function hyperConfirmTriggerSecret(owner: BrowserWindow, pathname: string, signal: AbortSignal, check: () => Promise<void>) {
  await check();
  const answer = await dialog.showMessageBox(owner, {
    type: 'warning', title: 'HyperTask trigger key', message: 'Continue with this event-trigger operation?',
    detail: `${pathname}\nGenerated or revealed keys are shown only in a native dialog. Rotation invalidates the previous key.`,
    buttons: ['Cancel', 'Continue'], defaultId: 0, cancelId: 0, signal,
  });
  await check();
  if (answer.response !== 1) throw new Error('Trigger operation cancelled');
}

/** Strip the secret before response bytes enter renderer IPC. Native copy is an explicit choice. */
export async function hyperProtectTriggerResponse(response: Response, owner: BrowserWindow, signal: AbortSignal, check: () => Promise<void>): Promise<Response> {
  if (!response.ok) {
    await response.body?.cancel();
    return new Response(JSON.stringify({ error: 'The trigger operation failed or was refused.' }), { status: response.status, headers: { 'content-type': 'application/json' } });
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Trigger response was unavailable');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength; if (bytes > 65536) throw new Error('Trigger response was too large');
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  await check();
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Trigger response was unreadable'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('secret' in value)) throw new Error('Trigger response was invalid');
  const result = value as Record<string, unknown>;
  const secret = result.secret;
  if (secret !== null) {
    if (typeof secret !== 'string' || !/^whsec_[A-Za-z0-9+/]{43}=$/.test(secret)) throw new Error('Trigger key response was invalid');
    const answer = await dialog.showMessageBox(owner, {
      type: 'info', title: 'HyperTask event-trigger key', message: 'Store this key securely.', detail: secret,
      buttons: ['Done', 'Copy key', 'Copy Authorization header'], defaultId: 0, cancelId: 0, signal,
    });
    await check();
    if (answer.response === 1) clipboard.writeText(secret);
    if (answer.response === 2) clipboard.writeText(`Authorization: Bearer ${secret}`);
  }
  await check();
  // Pinned mutation DTOs contain trigger/sharedApps; the reveal DTO has no public fields.
  const metadata = { ...(result.trigger ? { trigger: result.trigger } : {}), ...(result.sharedApps ? { sharedApps: result.sharedApps } : {}), nativeSecretHandled: true };
  delete result.secret;
  return new Response(JSON.stringify(metadata), { status: response.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
