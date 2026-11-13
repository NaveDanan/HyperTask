import http from 'node:http';
import https from 'node:https';
import { isVendorUrl } from '../shared/self-hosted-policy';
import type { HyperBookmarkMetadataReply, HyperBookmarkOwner } from '../shared/api';

export const HYPER_BOOKMARK_MAX_BYTES = 2 * 1024 * 1024;
export interface HyperBookmarkRuntime { revision(): number; identity(): Promise<HyperBookmarkOwner> }
export function hyperBookmarkOwnerValue(value: unknown): HyperBookmarkOwner {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['actorId', 'workspaceId'].includes(key))) throw Error('A captured account and workspace are required.');
  const fields = value as Record<string, unknown>;
  const actorId = fields.actorId, workspaceId = fields.workspaceId;
  if (typeof actorId !== 'string' || typeof workspaceId !== 'string' || !actorId.trim() || !workspaceId.trim() || actorId.length > 256 || workspaceId.length > 256 || /[\u0000-\u001f\u007f]/u.test(actorId + workspaceId)) throw Error('A captured account and workspace are required.');
  return { actorId, workspaceId };
}
export function hyperBookmarkRequestUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value)) throw Error('Enter a complete HTTP or HTTPS link.');
  let url: URL; try { url = new URL(value); } catch { throw Error('Enter a complete HTTP or HTTPS link.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname || isVendorUrl(url.href)) throw Error('This link cannot be loaded without credentials.');
  url.hash = ''; return url;
}
/** Plain Node HTTP has no Chromium cookie jar, automatic auth, app headers or shared cache. */
function requestPage(url: URL, signal: AbortSignal): Promise<HyperBookmarkMetadataReply | { redirect: string }> {
  return new Promise((resolve, reject) => {
    let remaining = HYPER_BOOKMARK_MAX_BYTES, settled = false;
    const fail = (message: string) => finish(new Error(message));
    const finish = (error?: Error, value?: HyperBookmarkMetadataReply | { redirect: string }) => {
      if (settled) return; settled = true; signal.removeEventListener('abort', abort); request.destroy();
      if (error) reject(error); else resolve(value!);
    };
    const abort = () => fail('The link metadata request was cancelled.');
    const request = (url.protocol === 'https:' ? https : http).request(url, { method: 'GET', headers: { Accept: 'text/html, application/xhtml+xml', 'Accept-Encoding': 'identity', 'Cache-Control': 'no-store' } }, response => {
      if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        if (!location || location.length > 4096 || /[\u0000-\u001f\u007f]/u.test(location)) { fail('The link returned an invalid redirect.'); return; }
        finish(undefined, { redirect: location }); return;
      }
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) { fail(`The link returned HTTP ${response.statusCode || 0}.`); return; }
      const type = response.headers['content-type'] || '';
      if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/iu.test(type) || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') { fail('This link did not return an uncompressed HTML page.'); return; }
      if (Number(response.headers['content-length']) > HYPER_BOOKMARK_MAX_BYTES) { fail('The link metadata response is too large.'); return; }
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => { if (settled) return; remaining -= chunk.length; if (remaining < 0) { fail('The link metadata response is too large.'); return; } chunks.push(chunk); });
      response.on('end', () => {
        if (settled) return;
        try { const charset = type.match(/charset\s*=\s*["']?([^\s;"']+)/iu)?.[1] || 'utf-8'; finish(undefined, { url: url.href, html: new TextDecoder(charset).decode(Buffer.concat(chunks)) }); }
        catch { fail('This link uses an unsupported text encoding.'); }
      });
      response.on('error', () => fail('The link metadata response was interrupted.'));
      response.on('aborted', () => fail('The link metadata response was interrupted.'));
    });
    request.on('error', () => fail('The link metadata could not be loaded.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else request.end();
  });
}
/** Redirects share one deadline and never inherit cookies, authorization or referrer headers. */
export async function hyperLoadBookmarkHtml(initial: URL, signal: AbortSignal, guard: () => Promise<void> = async () => {}): Promise<HyperBookmarkMetadataReply> {
  const controller = new AbortController(), abort = () => controller.abort(); let timedOut = false;
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 8000), seen = new Set<string>(); let url = hyperBookmarkRequestUrl(initial.href);
  try {
    for (let hop = 0; hop <= 3; hop++) {
      await guard(); if (controller.signal.aborted) throw Error('The link metadata request was cancelled.');
      if (seen.has(url.href)) throw Error('The link redirects in a cycle.'); seen.add(url.href);
      const result = await requestPage(url, controller.signal); await guard();
      if ('html' in result) return result;
      if (hop === 3) throw Error('The link redirects too many times.');
      try { url = hyperBookmarkRequestUrl(new URL(result.redirect, url).href); }
      catch { throw Error('The link redirects to an unsupported or credential-bearing address.'); }
    }
    throw Error('The link could not be loaded.');
  } catch (error) { if (timedOut) throw Error('The link metadata request timed out.'); throw error; }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); }
}
export function hyperBookmarkUntilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(Error('The link metadata request was cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}
export class HyperBookmarkMetadata {
  private pending = new Set<AbortController>();
  constructor(private readonly runtime: HyperBookmarkRuntime, private readonly load = hyperLoadBookmarkHtml) {}
  invalidate() { for (const controller of this.pending) controller.abort(); }
  async loadUrl(raw: unknown, rawOwner: unknown): Promise<HyperBookmarkMetadataReply> {
    const owner = hyperBookmarkOwnerValue(rawOwner), url = hyperBookmarkRequestUrl(raw), revision = this.runtime.revision();
    if (this.pending.size >= 4) throw Error('Wait for the other link requests to finish.');
    const controller = new AbortController(); this.pending.add(controller); let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    const current = () => { if (controller.signal.aborted || revision !== this.runtime.revision()) throw Error('The account or workspace changed. Load the link again.'); };
    const identity = async () => { current(); const fresh = await hyperBookmarkUntilAborted(this.runtime.identity(), controller.signal); current(); if (fresh.actorId !== owner.actorId || fresh.workspaceId !== owner.workspaceId) throw Error('The account or workspace changed. Load the link again.'); };
    try { await identity(); const reply = await this.load(url, controller.signal, identity); await identity(); return reply; }
    catch (error) { if (timedOut) throw Error('The link metadata request timed out.'); throw error; }
    finally { clearTimeout(timer); controller.abort(); this.pending.delete(controller); }
  }
}
