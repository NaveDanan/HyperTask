import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { net } from 'electron';
import type { OpenAIEndpointDiscoveryRequest, OpenAIEndpointTestRequest } from '@shared/api';
import { unprotect } from './dpapi';
import {
  endpointApiUrl,
  completionTestBody,
  httpStatusMessage,
  parseCompletionBody,
  unreachableMessage,
  validateEndpoint,
  validateEndpointBaseUrl, parseEndpointModelPage,
} from '@shared/openai-endpoint';
import { timeoutMessage } from './powershell';
import { SettingsError } from './settings-error';

const TIMEOUT_MS = 30_000;
const DISCOVERY_TIMEOUT_MS = 15_000;
const MAX_MODEL_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_MODEL_BYTES = 8 * 1024 * 1024;
export type EndpointKeyResolver = (protectedKey: string) => Promise<string>;

function validateEndpointCredentialRequest(request: { protectedKey: string; apiKey?: string }) {
  if (typeof request.protectedKey !== 'string' || (request.apiKey !== undefined && typeof request.apiKey !== 'string')) throw new SettingsError('format', 'Invalid AI credential request.');
  if (request.protectedKey.length > 65536 || (request.apiKey?.length ?? 0) > 32768) throw new SettingsError('format', 'The AI credential is too long.');
}
function validatePlainKey(key: string) {
  if (/[^\u0020-\u007e]/.test(key)) throw new SettingsError('format', 'The API key must contain only printable ASCII characters.');
}

function discoveryAbortError() { return new SettingsError('other', 'Model discovery was cancelled or timed out.'); }
function waitForCredential(pending: Promise<string>, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(discoveryAbortError());
    signal.addEventListener('abort', aborted, { once: true });
    pending.then(value => { signal.removeEventListener('abort', aborted); resolve(value); }, error => { signal.removeEventListener('abort', aborted); reject(error); });
    if (signal.aborted) aborted();
  });
}

function getModelsPage(url: string, key: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(discoveryAbortError()); return; }
    let settled = false;
    const request = net.request({ method: 'GET', url, redirect: 'manual' });
    const finish = (error?: SettingsError, body?: string) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort);
      if (error) { request.abort(); reject(error); } else resolve(body ?? '');
    };
    const abort = () => finish(discoveryAbortError());
    signal.addEventListener('abort', abort, { once: true });
    try {
      request.setHeader('Accept', 'application/json');
      // Credential edits must be checked against the server, not a cached model response.
      request.setHeader('Cache-Control', 'no-store, no-cache');
      request.setHeader('Pragma', 'no-cache');
      if (key) request.setHeader('Authorization', `Bearer ${key}`);
    } catch { finish(new SettingsError('format', 'The AI credential could not be used as an HTTP header.')); return; }
    request.on('redirect', status => finish(new SettingsError('state', `Models endpoint returned HTTP ${status}. Redirects are not followed.`)));
    request.on('error', () => finish(new SettingsError('state', unreachableMessage)));
    request.on('response', response => {
      if (settled) return;
      if (response.statusCode < 200 || response.statusCode >= 300) { finish(new SettingsError('state', `Models endpoint returned HTTP ${response.statusCode}. Check the API base URL and credential.`)); return; }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > MAX_MODEL_PAGE_BYTES) { finish(new SettingsError('state', 'The models response exceeded the size limit.')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => { if (!settled) finish(undefined, Buffer.concat(chunks).toString('utf8')); });
      response.on('error', () => finish(new SettingsError('state', unreachableMessage)));
      response.on('aborted', () => finish(new SettingsError('state', unreachableMessage)));
    });
    try { request.end(); } catch { finish(new SettingsError('state', unreachableMessage)); }
  });
}

/** Discover all safely paginated models without saving or requiring a default model. */
export async function discoverEndpoint(request: OpenAIEndpointDiscoveryRequest, signal?: AbortSignal, resolveKey: EndpointKeyResolver = unprotect): Promise<{ models: string[] }> {
  if (!request || typeof request.baseUrl !== 'string' || typeof request.protectedKey !== 'string' || (request.apiKey !== undefined && typeof request.apiKey !== 'string') || (request.requestId !== undefined && (typeof request.requestId !== 'string' || request.requestId.length > 128))) throw new SettingsError('format', 'Invalid model discovery request.');
  validateEndpointBaseUrl(request.baseUrl);
  validateEndpointCredentialRequest(request);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, DISCOVERY_TIMEOUT_MS);
  let key = '';
  try {
    if (controller.signal.aborted) throw discoveryAbortError();
    key = request.apiKey !== undefined ? request.apiKey : await waitForCredential(resolveKey(request.protectedKey), controller.signal);
    validatePlainKey(key);
    let url: string | null = endpointApiUrl(request.baseUrl, 'models'), bytes = 0;
    const seen = new Set<string>(), models = new Set<string>();
    for (let page = 0; url !== null; page++) {
      if (page >= 100) throw new SettingsError('state', 'Model discovery exceeded the pagination limit. No partial model list was returned.');
      const identity = new URL(url); identity.searchParams.sort();
      if (seen.has(identity.href)) throw new SettingsError('state', 'The models endpoint repeated a pagination URL.');
      seen.add(identity.href);
      const body = await getModelsPage(url, key, controller.signal);
      bytes += Buffer.byteLength(body);
      if (bytes > MAX_MODEL_BYTES) throw new SettingsError('state', 'The models response exceeded the total size limit.');
      const parsed = parseEndpointModelPage(body, url, request.baseUrl);
      parsed.models.forEach(model => models.add(model));
      if (models.size > 100000) throw new SettingsError('state', 'The models response exceeded the model count limit.');
      url = parsed.nextUrl;
    }
    return { models: [...models].sort() };
  } finally {
    key = ''; clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}

/**
 * OpenAIEndpointSettings.save() file step: `<support>/local_ai/openai-endpoint.json`,
 * written and flushed. Returns the path that goes after the `openai+file:` prefix.
 */
export async function writeEndpointSettings(supportDirectory: string, json: string): Promise<string> {
  const directory = path.join(supportDirectory, 'local_ai');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'openai-endpoint.json');
  const temporary = path.join(directory, `.openai-endpoint-${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  let created = false;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    created = true;
    await handle.writeFile(json, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, file);
  } finally {
    await handle?.close().catch(() => {});
    if (created) await fs.rm(temporary, { force: true });
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
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > MAX_MODEL_PAGE_BYTES) { fail(new SettingsError('state', 'The endpoint response exceeded the size limit.')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => done(() => resolve({ status, body: Buffer.concat(chunks).toString('utf8') })));
      response.on('error', () => fail(new SettingsError('state', unreachableMessage)));
      response.on('aborted', () => fail(new SettingsError('state', unreachableMessage)));
    });
    request.end(body);
  });
}

/** OpenAIEndpointSettings.testConnection(), run from the main process (Chromium's TLS trusts the Windows store). */
export async function testEndpoint(request: OpenAIEndpointTestRequest, resolveKey: EndpointKeyResolver = unprotect): Promise<void> {
  validateEndpoint(request.baseUrl, request.model);
  validateEndpointCredentialRequest(request);
  const key = request.apiKey !== undefined ? request.apiKey : await resolveKey(request.protectedKey);
  validatePlainKey(key);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key !== '') headers.Authorization = `Bearer ${key}`;
  const response = await post(endpointApiUrl(request.baseUrl, 'chat/completions'), headers, completionTestBody(request.model));
  if (response.status < 200 || response.status >= 300) {
    throw new SettingsError('state', httpStatusMessage(response.status));
  }
  parseCompletionBody(response.body ?? '');
}
