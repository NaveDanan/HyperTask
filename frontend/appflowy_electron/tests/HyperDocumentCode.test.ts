import { create, clone } from '@bufbuild/protobuf';
import { createStore } from 'zustand';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { hyperBlockData, hyperBlockText, hyperEditText, hyperPlainText, hyperUpdateBlock } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperCaptureDocumentCode, hyperCodeSource, hyperIndentDocumentCode, hyperSaveCodeLanguage } from '../src/renderer/features/document-code/HyperDocumentCodeModel';
import { hyperCodeLanguageMarker, hyperParseCodeLanguageMarker } from '../src/renderer/features/document-code/HyperDocumentCodeValue';
import { createHyperDocumentCodeStore } from '../src/renderer/features/document-code/HyperDocumentCodeStore';
import { hyperExportDocument } from '../src/renderer/features/document/HyperDocumentExport';
import { hyperGetDocumentOwner } from '../src/renderer/features/document/HyperDocumentOwner';
import type { HyperDocumentSession } from '../src/renderer/features/document/HyperDocumentSession';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { useAppStore } from '../src/renderer/startup/app-store';
function document(source = '😀a\n  b\n\tc\n', data: Record<string, unknown> = { language: null, unknown: { keep: true } }) {
  return hyperEditText(create(DocumentDataPBSchema, { pageId: 'page', blocks: { page: { id: 'page', ty: 'page', childrenId: 'children', data: '{}' }, code: { id: 'code', parentId: 'page', ty: 'code', childrenId: 'codechildren', data: JSON.stringify(data) } }, meta: { childrenMap: { children: { children: ['code'] }, codechildren: { children: [] } } } }), 'code', [{ insert: source }]).document;
}
const source = (doc: DocumentDataPB) => hyperCodeSource(doc, 'code');
describe('Hyper compatible code blocks', () => {
  it('retains source, unknown fields and future language names, rejecting changed source/position/language', () => {
    const doc = document(), target = hyperCaptureDocumentCode(doc, 'code');
    const unrelated = hyperUpdateBlock(doc, 'code', { unknown: { keep: true, newer: 'retained' } }).document, future = hyperSaveCodeLanguage(unrelated, target, 'future language#2').document;
    expect(source(future)).toBe(source(doc)); expect(hyperBlockData(future.blocks.code)).toEqual({ language: 'future language#2', unknown: { keep: true, newer: 'retained' } });
    for (const changed of [hyperEditText(doc, 'code', [{ insert: 'changed' }]).document, hyperUpdateBlock(doc, 'code', { language: 'python' }).document]) expect(() => hyperSaveCodeLanguage(changed, target, 'rust')).toThrow('changed');
    const moved = clone(DocumentDataPBSchema, doc); moved.meta!.childrenMap.children.children = []; expect(() => hyperSaveCodeLanguage(moved, target, 'rust')).toThrow('attached');
    expect(() => hyperSaveCodeLanguage(doc, target, 'bad\nlang')).toThrow('control');
  });
  it('keeps absent, null, empty and unknown exact languages in bounded inert HTML metadata', () => {
    for (const data of [{}, { language: null }, { language: '' }, { language: 'Future # language\"<&' }]) {
      const doc = document('  <x>\n```\n', data), marker = hyperCodeLanguageMarker(doc.blocks.code);
      expect(hyperParseCodeLanguageMarker(marker)).toEqual(data); const html = hyperExportDocument(doc, 'html'); expect(html).toContain('data-hyper-code-language='); expect(html).toContain('&lt;x&gt;');
    }
    expect(hyperExportDocument(document('```\nsource', { language: 'rust' }), 'markdown')).toContain('````rust\n```\nsource\n````');
    expect(() => hyperExportDocument(document('raw', { language: 'c#' }), 'markdown')).toThrow('Export HTML');
    expect(() => hyperExportDocument(document('raw', { language: { future: true } }), 'html')).toThrow('unsupported');
    for (const marker of ['{}', '{"version":2,"present":true,"value":"x"}', '{"version":1,"present":false,"value":null}', '{"version":1,"present":true,"value":{}}', 'x'.repeat(8193)]) expect(hyperParseCodeLanguageMarker(marker)).toBeNull();
  });
  it('indents UTF16 ranges, excludes an end-at-next-line boundary and preserves marked runs', () => {
    const original = hyperEditText(document(), 'code', [{ insert: '😀a', attributes: { bold: true, future: { key: 1 } } }, { insert: '\n  b\n\tc\n', attributes: { color: 'red' } }]).document;
    const changed = hyperIndentDocumentCode(original, hyperCaptureDocumentCode(original, 'code'), { start: 0, end: 4 }, false);
    expect(source(changed.document)).toBe('  😀a\n  b\n\tc\n'); expect(changed.selection).toEqual({ start: 2, end: 6 });
    expect(hyperBlockText(changed.document, changed.document.blocks.code)).toContainEqual({ insert: '😀a', attributes: { bold: true, future: { key: 1 } } });
    const restored = hyperIndentDocumentCode(changed.document, hyperCaptureDocumentCode(changed.document, 'code'), changed.selection, true); expect(source(restored.document)).toBe(source(original));
    expect(() => hyperIndentDocumentCode(original, hyperCaptureDocumentCode(original, 'code'), { start: 1, end: 1 }, false)).toThrow('selection');
  });
  it('handles first empty lines, trailing empty lines, one-space and tab outdent without skipping line zero', () => {
    const first = document('\n x\n'); const changed = hyperIndentDocumentCode(first, hyperCaptureDocumentCode(first, 'code'), { start: 0, end: 3 }, false);
    expect(source(changed.document)).toBe('  \n   x\n');
    const outdent = hyperIndentDocumentCode(first, hyperCaptureDocumentCode(first, 'code'), { start: 0, end: 0 }, true); expect(outdent.actions).toEqual([]); expect(source(outdent.document)).toBe('\n x\n');
    const doc = document(' x\n\ty\n'), result = hyperIndentDocumentCode(doc, hyperCaptureDocumentCode(doc, 'code'), { start: 0, end: source(doc).length }, true); expect(source(result.document)).toBe('x\ny\n'); expect(result.selection).toEqual({ start: 0, end: 4 });
    const empty = document(''); const added = hyperIndentDocumentCode(empty, hyperCaptureDocumentCode(empty, 'code'), { start: 0, end: 0 }, false); expect(source(added.document)).toBe('  '); expect(added.selection).toEqual({ start: 2, end: 2 });
  });
  it('accepts native semantic run normalization and leaves unknown language data untouched during typing', () => {
    const original = hyperEditText(document('', { language: { future: true } }), 'code', [{ insert: 'ab', attributes: { future: 1, bold: true } }]).document, target = hyperCaptureDocumentCode(original, 'code');
    const normalized = hyperEditText(original, 'code', [{ insert: 'a', attributes: { bold: true, future: 1 } }, { insert: 'b', attributes: { future: 1, bold: true } }]).document;
    const changed = hyperIndentDocumentCode(normalized, target, { start: 2, end: 2 }, false); expect(source(changed.document)).toBe('ab  '); expect(hyperBlockData(changed.document.blocks.code).language).toEqual({ future: true });
    const embedded = document(); embedded.meta!.textMap[embedded.blocks.code.oneOfExternalId.value!] = JSON.stringify([{ insert: { future: 'embed' } }]); expect(() => hyperCodeSource(embedded, 'code')).toThrow('embedded'); expect(hyperPlainText(hyperBlockText(embedded, embedded.blocks.code))).toBeTruthy();
  });
});
const previousApp = useAppStore.getState(), previousWorkspace = useWorkspaceStore.getState();
beforeEach(() => { useAppStore.setState({ dataDirectory: '/isolated-code-tests' }); useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 1n }), currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace' }), actionResult: null }); });
afterEach(() => { useAppStore.setState(previousApp, true); useWorkspaceStore.setState(previousWorkspace, true); });
function fixture() {
  const state = createStore(() => ({ document: document('exact\n', {}), status: 'ready', historyPending: false, error: null }));
  const session = { id: 'page', store: state, belongsTo: () => true, isCurrentOwner: () => true, flush: vi.fn(async () => {}), refresh: vi.fn(async () => {}), change: vi.fn((build: (doc: DocumentDataPB) => { document: DocumentDataPB }) => { const result = build(state.getState().document); state.setState({ document: result.document }); return result; }) };
  let editable = true; const backend = { validate: vi.fn(async () => {}) }, store = createHyperDocumentCodeStore({ session: session as unknown as HyperDocumentSession, owner: hyperGetDocumentOwner()!, editable: () => editable }, backend);
  return { state, session, backend, store, readOnly: () => { editable = false; } };
}
describe('Hyper guarded code language saves', () => {
  it('opening or unchanged saving does not promote absent language to explicit null', async () => { const f = fixture(); await f.store.open('code'); expect(f.store.getState()).toMatchObject({ status: 'editing', dirty: false }); expect(await f.store.save()).toBe(false); expect(f.session.change).not.toHaveBeenCalled(); expect(hyperBlockData(f.state.getState().document.blocks.code)).toEqual({}); f.store.setLanguage(null); expect(await f.store.save()).toBe(true); expect(hyperBlockData(f.state.getState().document.blocks.code)).toEqual({ language: null }); });
  it('choosing the same present language is a no-op', async () => { const f = fixture(); f.state.setState({ document: document('exact', { language: null }) }); await f.store.open('code'); f.store.setLanguage(null); expect(f.store.getState().dirty).toBe(false); expect(await f.store.save()).toBe(false); expect(f.session.change).not.toHaveBeenCalled(); });
  it.each(['owner', 'permission', 'history', 'source', 'position'])('blocks %s changes before mutation', async mode => {
    const f = fixture(); await f.store.open('code'); f.store.setLanguage('rust');
    if (mode === 'owner') { useAppStore.setState({ dataDirectory: '/different' }); useAppStore.setState({ dataDirectory: '/isolated-code-tests' }); }
    if (mode === 'permission') f.readOnly(); if (mode === 'history') f.state.setState({ historyPending: true });
    if (mode === 'source') f.state.setState({ document: hyperEditText(f.state.getState().document, 'code', [{ insert: 'changed' }]).document });
    if (mode === 'position') { const doc = clone(DocumentDataPBSchema, f.state.getState().document); doc.meta!.childrenMap.children.children = []; f.state.setState({ document: doc }); }
    expect(await f.store.save()).toBe(false); expect(f.session.change).not.toHaveBeenCalled();
  });
  it('retains recovery after uncertain acknowledgment and never replays the accepted write', async () => { const f = fixture(); await f.store.open('code'); f.store.setLanguage('future'); f.session.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('Lost acknowledgment')); expect(await f.store.save()).toBe(false); expect(f.store.getState().status).toBe('partial'); expect(JSON.parse(JSON.parse(f.store.details()).target.runs)[0].insert).toBe('exact\n'); await f.store.save(); expect(f.session.change).toHaveBeenCalledTimes(1); });
  it('discards late open replies after cancellation or owner loss', async () => { const f = fixture(); let release!: () => void; f.backend.validate.mockImplementation(() => new Promise<void>(resolve => { release = resolve; })); const pending = f.store.open('code'); f.store.close(); release(); await pending; expect(f.store.getState().status).toBe('idle'); const pendingOwner = f.store.open('code'); useAppStore.setState({ dataDirectory: '/other' }); release(); await pendingOwner; expect(f.store.getState().status).toBe('idle'); });
});
