import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hyperCodeSyntaxTokenize } from '../src/renderer/features/document-code/HyperCodeSyntaxEngine';
import { HyperCodeSyntaxClient, type HyperCodeSyntaxWorker } from '../src/renderer/features/document-code/HyperCodeSyntaxClient';
import { hyperCodeSyntaxLanguage, hyperCodeSyntaxLimits, hyperCodeSyntaxReply, hyperCodeSyntaxSource } from '../src/renderer/features/document-code/HyperCodeSyntaxTypes';
import { hyperCodeSyntaxRespectMarks } from '../src/renderer/features/document-code/HyperCodeSyntaxRanges';
describe('Hyper local bounded syntax engine', () => {
  it('retains the exact verified official core, grammar and BSD license bytes', () => {
    const root = path.resolve(__dirname, '../src/renderer/features/document-code/vendor/highlightjs'), provenance = JSON.parse(fs.readFileSync(path.join(root, 'provenance.json'), 'utf8'));
    expect(provenance).toMatchObject({ name: 'highlight.js', version: '11.11.1', license: 'BSD-3-Clause', metadata: 'https://registry.npmjs.org/highlight.js/11.11.1', tarball: 'https://registry.npmjs.org/highlight.js/-/highlight.js-11.11.1.tgz' });
    expect(provenance.integrity).toBe('sha512-Xwwo44whKBVCYoliBQwaPvtd/2tYFkRQtXDWj1nackaV2JPXx3L0+Jvd8/qCJ2p+ML0/XVkJ2q+Mr+UVdpJK5w==');
    for (const [name, expected] of Object.entries(provenance.files) as Array<[string, { bytes: number; sha256: string }]>) { const bytes = fs.readFileSync(path.join(root, name)); expect(bytes.length).toBe(expected.bytes); expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected.sha256); }
    expect(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')).toContain('BSD 3-Clause License');
  });
  it.each([{ source: 'const answer = value => console.log("שלום 😀", value + 1);', language: 'javascript' }, { source: 'def greet(name):\n    # comment\n    return f"hello {name}"\n', language: 'python' }])('uses real bounded Automatic detection: $language', ({ source, language }) => { const result = hyperCodeSyntaxTokenize(source, null, 1); expect(result).toMatchObject({ status: 'ready', language }); expect(result.html).toContain('hljs-'); });
  it.each(['bash', 'css', 'html', 'javascript', 'json', 'markdown', 'python', 'rust', 'sql', 'typescript'])('supports the current picker grammar closure: %s', language => { const result = hyperCodeSyntaxTokenize('value = "source";\n', language, 1); expect(result.status).toBe('ready'); expect(hyperCodeSyntaxReply(result, 1)).toBe(true); });
  it('keeps unknown tags plain and raw tags unchanged, escapes source HTML and recognizes aliases only for rendering', () => {
    for (const language of ['', '__proto__', 'constructor', 'toString', 'future # language', 'C#']) expect(hyperCodeSyntaxTokenize('source', language, 1).status).toBe('plain');
    const raw = ' JavaScript ', source = 'const html = "<img src=http://127.0.0.1/trap> & 😀";'; const result = hyperCodeSyntaxTokenize(source, raw, 1); expect(result.status).toBe('ready'); expect(result.html).toContain('&lt;img'); expect(result.html).not.toContain('<img'); expect(raw).toBe(' JavaScript '); expect(hyperCodeSyntaxLanguage('py')).toBe('python');
  });
  it('bounds source/line/line count before parsing and validates reply IDs/keys/size', () => {
    for (const source of ['a'.repeat(hyperCodeSyntaxLimits.source + 1), 'a'.repeat(hyperCodeSyntaxLimits.line + 1), '\n'.repeat(hyperCodeSyntaxLimits.lines + 1)]) { expect(hyperCodeSyntaxSource(source)).toBe(false); expect(hyperCodeSyntaxTokenize(source, null, 1).status).toBe('plain'); }
    const reply = hyperCodeSyntaxTokenize('let x = 1;', 'javascript', 4); expect(hyperCodeSyntaxReply(reply, 4)).toBe(true); for (const value of [{ ...reply, id: 5 }, { ...reply, secret: 'no' }, { ...reply, language: 'future' }, { ...reply, html: 'x'.repeat(hyperCodeSyntaxLimits.html + 1) }]) expect(hyperCodeSyntaxReply(value, 4)).toBe(false);
  });
  it('keeps authored colors/links/atomic marks and unknown run attributes intact', () => {
    const ranges = [{ start: 0, end: 12, kind: 'string' as const }], runs = [{ insert: 'aa', attributes: { bold: true, future: 'kept' } }, { insert: 'bb', attributes: { font_color: 'red' } }, { insert: 'cc', attributes: { href: 'https://example.com' } }, { insert: 'dd', attributes: { bg_color: 'blue' } }, { insert: 'eeee' }], before = JSON.stringify(runs);
    expect(hyperCodeSyntaxRespectMarks(ranges, runs)).toEqual([{ start: 0, end: 2, kind: 'string' }, { start: 8, end: 12, kind: 'string' }]); expect(JSON.stringify(runs)).toBe(before); expect(hyperCodeSyntaxRespectMarks(ranges, [{ insert: { future: 'embed' } }])).toEqual([]);
  });
});
class FakeWorker implements HyperCodeSyntaxWorker {
  onmessage: HyperCodeSyntaxWorker['onmessage'] = null; onerror: HyperCodeSyntaxWorker['onerror'] = null;
  postMessage = vi.fn(); terminate = vi.fn();
  send(data: unknown) { this.onmessage?.({ data } as MessageEvent<unknown>); }
  ready() { this.send({ version: 1, ready: true, engine: 'highlight.js@11.11.1', license: 'BSD 3-Clause test notice' }); }
  reply() { const request = this.postMessage.mock.calls.at(-1)![0] as { id: number }; this.send({ version: 1, id: request.id, status: 'ready', html: 'source', language: 'javascript' }); }
}
const clients: HyperCodeSyntaxClient[] = [];
function clientFixture() { const workers: FakeWorker[] = []; let owner = true; const client = new HyperCodeSyntaxClient(() => owner, () => { const worker = new FakeWorker(); workers.push(worker); return worker; }); clients.push(client); return { client, workers, loseOwner: () => { owner = false; } }; }
afterEach(() => { for (const client of clients.splice(0)) client.dispose(); vi.useRealTimers(); });
describe('Hyper bounded cancellable syntax worker client', () => {
  it('coalesces latest queued work without rewriting source or language', async () => { const f = clientFixture(), key = {}, first = f.client.request(key, 'old', null, () => true), next = f.client.request(key, 'source', ' JavaScript ', () => true); expect(await first).toBeNull(); f.workers[0].ready(); expect(f.workers[0].postMessage).toHaveBeenCalledWith({ version: 1, id: 2, source: 'source', language: ' JavaScript ' }); f.workers[0].reply(); expect(await next).toMatchObject({ id: 2, status: 'ready' }); });
  it('bounds pending queue and source requests before starting another worker', async () => { const f = clientFixture(), pending = Array.from({ length: hyperCodeSyntaxLimits.queue }, () => f.client.request({}, 'source', null, () => true)); expect(await f.client.request({}, 'source', null, () => true)).toBeNull(); expect(await f.client.request({}, 'x'.repeat(hyperCodeSyntaxLimits.source + 1), null, () => true)).toBeNull(); expect(f.workers).toHaveLength(1); f.client.dispose(); expect((await Promise.all(pending)).every(value => value === null)).toBe(true); });
  it('terminates on hard startup and parsing deadlines, retaining no unresolved work', async () => { vi.useFakeTimers(); const f = clientFixture(), startup = f.client.request({}, 'source', null, () => true); await vi.advanceTimersByTimeAsync(hyperCodeSyntaxLimits.startupMs); expect(await startup).toBeNull(); expect(f.workers[0].terminate).toHaveBeenCalledTimes(1); const request = f.client.request({}, 'source', null, () => true); f.workers[1].ready(); await vi.advanceTimersByTimeAsync(hyperCodeSyntaxLimits.jobMs); expect(await request).toBeNull(); expect(f.workers[1].terminate).toHaveBeenCalledTimes(1); });
  it('terminates old owner work promptly and blocks late responses or dispose replays', async () => { vi.useFakeTimers(); const f = clientFixture(), request = f.client.request({}, 'source', null, () => true); f.workers[0].ready(); f.loseOwner(); await vi.advanceTimersByTimeAsync(25); f.workers[0].reply(); expect(await request).toBeNull(); expect(f.workers[0].terminate).toHaveBeenCalledTimes(1); expect(await f.client.request({}, 'source', null, () => true)).toBeNull(); expect(f.workers).toHaveLength(1); });
  it('isolates cancellation between leases and rejects malformed/error responses', async () => { const f = clientFixture(), key = {}, first = f.client.request(key, 'source', null, () => true), second = f.client.request({}, 'source', null, () => true); f.workers[0].ready(); f.client.cancel(key); expect(await first).toBeNull(); expect(f.workers).toHaveLength(2); f.workers[0].reply(); f.workers[1].ready(); f.workers[1].reply(); expect(await second).toMatchObject({ status: 'ready' }); const invalid = f.client.request({}, 'source', null, () => true); f.workers[1].send({ version: 1, id: -1 }); expect(await invalid).toBeNull(); expect(f.workers[1].terminate).toHaveBeenCalledTimes(1); });
  it('falls back on Worker creation or runtime failures and stale DOM revisions', async () => { const broken = new HyperCodeSyntaxClient(() => true, () => { throw Error('Worker blocked'); }); clients.push(broken); expect(await broken.request({}, 'source', null, () => true)).toBeNull(); const f = clientFixture(); let current = true; const request = f.client.request({}, 'source', null, () => current); f.workers[0].ready(); current = false; f.workers[0].reply(); expect(await request).toBeNull(); const error = f.client.request({}, 'source', null, () => true); f.workers[0].onerror?.({} as ErrorEvent); expect(await error).toBeNull(); });
});
