import fs from 'node:fs/promises';
import path from 'node:path';
import { net } from 'electron';
import type { OpenAIEndpointTestRequest } from '@shared/api';
import { unprotect } from './dpapi';
import {
  endpointApiUrl,
  completionTestBody,
  httpStatusMessage,
  parseCompletionBody,
  unreachableMessage,
  validateEndpoint,
} from '@shared/openai-endpoint';
import { timeoutMessage } from './powershell';
import { SettingsError } from './settings-error';

const TIMEOUT_MS = 30_000;

/**
 * OpenAIEndpointSettings.save() file step: `<support>/local_ai/openai-endpoint.json`,
 * written and flushed. Returns the path that goes after the `openai+file:` prefix.
 */
export async function writeEndpointSettings(supportDirectory: string, json: string): Promise<string> {
  const directory = path.join(supportDirectory, 'local_ai');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'openai-endpoint.json');
  const handle = await fs.open(file, 'w');
  try {
    await handle.writeFile(json, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return file;
}

interface RawResponse {
  status: number;
  body: string | null;
}

/** One POST with redirects not followed: a redirect resolves with its status and no body. */
function post(url: string, headers: Record<string, string>, body: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout;
    const done = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const request = net.request({ method: 'POST', url, redirect: 'manual' });
    const fail = (error: SettingsError) =>
      done(() => {
        request.abort();
        reject(error);
      });
    timer = setTimeout(() => fail(new SettingsError('other', timeoutMessage(TIMEOUT_MS))), TIMEOUT_MS);

    for (const [name, value] of Object.entries(headers)) request.setHeader(name, value);
    // A credential must never travel to an unconfigured host.
    request.on('redirect', (status) =>
      done(() => {
        request.abort();
        resolve({ status, body: null });
      }),
    );
    request.on('error', () => fail(new SettingsError('state', unreachableMessage)));
    request.on('response', (response) => {
      if (settled) return;
      const status = response.statusCode;
      if (status < 200 || status >= 300) {
        done(() => {
          request.abort();
          resolve({ status, body: null });
        });
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => fail(new SettingsError('other', timeoutMessage(TIMEOUT_MS))), TIMEOUT_MS);
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => done(() => resolve({ status, body: Buffer.concat(chunks).toString('utf8') })));
      response.on('error', () => fail(new SettingsError('state', unreachableMessage)));
      response.on('aborted', () => fail(new SettingsError('state', unreachableMessage)));
    });
    request.end(body);
  });
}

/** OpenAIEndpointSettings.testConnection(), run from the main process (Chromium's TLS trusts the Windows store). */
export async function testEndpoint(request: OpenAIEndpointTestRequest): Promise<void> {
  validateEndpoint(request.baseUrl, request.model);
  const key = await unprotect(request.protectedKey);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key !== '') headers.Authorization = `Bearer ${key}`;
  const response = await post(endpointApiUrl(request.baseUrl, 'chat/completions'), headers, completionTestBody(request.model));
  if (response.status < 200 || response.status >= 300) {
    throw new SettingsError('state', httpStatusMessage(response.status));
  }
  parseCompletionBody(response.body ?? '');
}
