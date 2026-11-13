import { create } from '@bufbuild/protobuf';
import { createStore } from 'zustand';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { hyperBlockText, hyperEditText, type HyperDocumentChange, type HyperTextRun } from '../src/renderer/features/document/HyperDocumentModel';
import type { HyperDocumentSession } from '../src/renderer/features/document/HyperDocumentSession';
import { hyperGetDocumentOwner } from '../src/renderer/features/document/HyperDocumentOwner';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { useAppStore } from '../src/renderer/startup/app-store';
import { hyperCaptureInlineMath, hyperCaptureInlineMathInsertion } from '../src/renderer/features/document-inline-math/HyperInlineMathModel';
import { createHyperInlineMathStore } from '../src/renderer/features/document-inline-math/HyperInlineMathStore';
import { hyperInlineMathAtomAt, hyperInlineMathDomSource, hyperInlineMathTextEditable } from '../src/renderer/features/document-inline-math/HyperInlineMathDom';
import { hyperRenderEquationMathML, hyperRenderInlineEquationMathML } from '../src/renderer/features/document-equation/HyperDocumentEquationMathML';
import { hyperApplyDocumentFormat, hyperCaptureDocumentFormat } from '../src/renderer/features/document-format/HyperDocumentFormatModel';

const previousApp = useAppStore.getState(), previousWorkspace = useWorkspaceStore.getState();
beforeEach(() => { useAppStore.setState({ dataDirectory: '/isolated-inline-math' }); useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 1n }), currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace' }), actionResult: null }); });
afterEach(() => { useAppStore.setState(previousApp, true); useWorkspaceStore.setState(previousWorkspace, true); });
function document(runs: HyperTextRun[] = [{ insert: '🌍' }, { insert: '$$', attributes: { formula: 'x', bold: true, opaque: { kept: true } } }, { insert: ' tail' }]) {
  return create(DocumentDataPBSchema, { pageId: 'page', blocks: { page: { id: 'page', ty: 'page', data: '{}', childrenId: 'children' }, p: { id: 'p', parentId: 'page', ty: 'paragraph', childrenId: 'p-children', data: JSON.stringify({ delta: runs }) } }, meta: { childrenMap: { children: { children: ['p'] }, 'p-children': { children: [] } } } });
}
function fixture(doc = document()) {
  const state = createStore(() => ({ document: doc, status: 'ready', historyPending: false, error: null }));
  const session = { id: 'page', store: state, belongsTo: () => true, isCurrentOwner: () => true, flush: vi.fn(async () => {}), refresh: vi.fn(async () => {}), change: vi.fn((build: (doc: DocumentDataPB) => HyperDocumentChange) => { const change = build(state.getState().document); state.setState({ document: change.document }); return change; }) };
  let editable = true; const backend = { validate: vi.fn(async () => {}) }, store = createHyperInlineMathStore({ session: session as unknown as HyperDocumentSession, owner: hyperGetDocumentOwner()!, editable: () => editable }, backend);
  return { state, session, backend, store, readOnly() { editable = false; } };
}
describe('Hyper inline math rendering and text compatibility', () => {
  it('separates inline/block cache keys in both render orders and through eviction', () => {
    const source = String.raw`\sum_{n=0}^\infty x_n`;
    const block = hyperRenderEquationMathML(source), inline = hyperRenderInlineEquationMathML(source);
    expect(block).toContain('display="block"'); expect(inline).not.toContain('display="block"'); expect(inline).toContain('<math');
    expect(hyperRenderEquationMathML(source)).toBe(block); expect(hyperRenderInlineEquationMathML(source)).toBe(inline);
    for (let i = 0; i < 40; i++) hyperRenderInlineEquationMathML(`x_${i}`);
    expect(hyperRenderEquationMathML(source)).toBe(block); expect(hyperRenderInlineEquationMathML(source)).toBe(inline);
    const reverse = String.raw`\frac ab`; expect(hyperRenderInlineEquationMathML(reverse)).not.toContain('display="block"'); expect(hyperRenderEquationMathML(reverse)).toContain('display="block"');
  });
  it.each([String.raw`\boxed{x}`, String.raw`\href{https://example.invalid}{x}`, String.raw`\includegraphics{x}`, '{'.repeat(65) + 'x' + '}'.repeat(65), 'x'.repeat(8193)])('retains the trusted renderer bounds for inline source: %s', formula => { expect(() => hyperRenderInlineEquationMathML(formula)).toThrow(); });
  it('indexes merged atoms with UTF-16 offsets and compares equivalent DOM run grouping', () => {
    const runs = hyperBlockText(document(), document().blocks.p); expect([0, 1].map(ordinal => hyperInlineMathAtomAt(runs, ordinal)?.offset)).toEqual([2, 3]);
    expect(hyperInlineMathAtomAt([{ insert: '$'.repeat(100000), attributes: { formula: 'x' } }], 99999)?.offset).toBe(99999);
    expect(hyperInlineMathTextEditable([{ insert: '$'.repeat(100000), attributes: { formula: 'x' } }])).toBe(false);
    expect(hyperInlineMathDomSource([{ insert: '$', attributes: { formula: 'x', opaque: { a: 1, b: 2 } } }, { insert: '$', attributes: { opaque: { b: 2, a: 1 }, formula: 'x' } }])).toBe(hyperInlineMathDomSource([{ insert: '$$', attributes: { formula: 'x', opaque: { a: 1, b: 2 } } }]));
    expect(hyperInlineMathTextEditable([{ insert: '$', attributes: { formula: { future: true } } }])).toBe(true);
    expect(hyperInlineMathTextEditable([{ insert: '$', attributes: { formula: 'x' }, futureOperation: true } as HyperTextRun])).toBe(false);
  });
  it('applies hyperlinks only to surrounding ordinary text while keeping math attributes and colors', () => {
    const doc = document(), selection = hyperCaptureDocumentFormat(doc, { id: 'p', selection: { start: 0, end: 9 } });
    const changed = hyperApplyDocumentFormat(doc, selection, { href: 'https://example.invalid', font_color: '#ff0000' });
    const math = hyperBlockText(changed.document, changed.document.blocks.p).find(run => run.attributes?.formula === 'x')!;
    expect(math.attributes).toMatchObject({ formula: 'x', bold: true, opaque: { kept: true }, font_color: expect.any(String) }); expect(math.attributes).not.toHaveProperty('href');
    expect(() => hyperApplyDocumentFormat(doc, hyperCaptureDocumentFormat(doc, { id: 'p', selection: { start: 2, end: 4 } }), { href: 'https://example.invalid' })).toThrow('ordinary text');
  });
});
describe('Hyper inline math scoped saves', () => {
  it('edits and unwraps exactly one merged atom, preserving opaque attributes and caret positions', async () => {
    const f = fixture(); await f.store.open(hyperCaptureInlineMath(f.state.getState().document, 'p', 3)); f.store.setFormula('y🌍'); expect(await f.store.save()).toEqual({ id: 'p', offset: 4 });
    let runs = hyperBlockText(f.state.getState().document, f.state.getState().document.blocks.p); expect(runs.filter(run => run.attributes?.formula).map(run => [run.insert, run.attributes?.formula])).toEqual([['$', 'x'], ['$', 'y🌍']]);
    await f.store.open(hyperCaptureInlineMath(f.state.getState().document, 'p', 3)); expect(await f.store.unwrap()).toEqual({ id: 'p', offset: 6 });
    runs = hyperBlockText(f.state.getState().document, f.state.getState().document.blocks.p); expect(runs.find(run => run.insert === 'y🌍')?.attributes).toEqual({ bold: true, opaque: { kept: true } });
  });
  it('inspects read-only and unknown payloads without native calls or writes', async () => {
    const f = fixture(document([{ insert: '$', attributes: { formula: { version: 2, raw: 'kept' } } }])); await f.store.open(hyperCaptureInlineMath(f.state.getState().document, 'p', 0)); expect(f.store.getState()).toMatchObject({ status: 'inspecting', supported: false }); expect(JSON.parse(f.store.getState().source)[0].attributes.formula.version).toBe(2); expect(await f.store.save()).toBeUndefined(); expect(await f.store.unwrap()).toBeUndefined(); expect(f.backend.validate).not.toHaveBeenCalled(); expect(f.session.change).not.toHaveBeenCalled();
    const readonly = fixture(); readonly.readOnly(); await readonly.store.open(hyperCaptureInlineMath(readonly.state.getState().document, 'p', 2)); expect(readonly.store.getState().status).toBe('inspecting'); expect(readonly.backend.validate).not.toHaveBeenCalled();
  });
  it('rejects changed source, permissions and pending history before mutation', async () => {
    for (const mode of ['source', 'permission', 'history']) {
      const f = fixture(); await f.store.open(hyperCaptureInlineMath(f.state.getState().document, 'p', 2)); f.store.setFormula('y');
      if (mode === 'source') f.state.setState({ document: hyperEditText(f.state.getState().document, 'p', [{ insert: 'changed' }]).document });
      if (mode === 'permission') f.readOnly(); if (mode === 'history') f.state.setState({ historyPending: true });
      expect(await f.store.save()).toBeUndefined(); expect(f.session.change).not.toHaveBeenCalled();
    }
  });
  it('rechecks a native permission reply and source refresh before any accepted change', async () => {
    const f = fixture(); await f.store.open(hyperCaptureInlineMath(f.state.getState().document, 'p', 2)); f.store.setFormula('y'); f.session.refresh.mockImplementation(async () => { f.state.setState({ document: hyperEditText(f.state.getState().document, 'p', [{ insert: 'newer native text' }]).document }); });
    expect(await f.store.save()).toBeUndefined(); expect(f.session.change).not.toHaveBeenCalled();
    const g = fixture(); await g.store.open(hyperCaptureInlineMath(g.state.getState().document, 'p', 2)); g.store.setFormula('y'); g.backend.validate.mockRejectedValueOnce(Error('Native lock changed')); expect(await g.store.save()).toBeUndefined(); expect(g.session.change).not.toHaveBeenCalled();
  });
  it('retains accepted uncertain saves with exact recovery attributes and never replays them', async () => {
    const f = fixture(document([{ insert: 'source', attributes: { italic: true, opaque: { keep: true } } }])); await f.store.open(hyperCaptureInlineMathInsertion(f.state.getState().document, { id: 'p', selection: { start: 0, end: 6 } })); f.store.setFormula('x🌍'); f.session.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('ACK lost'));
    expect(await f.store.save()).toBeUndefined(); expect(f.store.getState()).toMatchObject({ status: 'partial', formula: 'x🌍', source: 'x🌍' }); expect(JSON.parse(f.store.getState().recovery).originalRuns[0].attributes).toEqual({ italic: true, opaque: { keep: true } });
    await f.store.save(); await f.store.unwrap(); expect(f.session.change).toHaveBeenCalledTimes(1);
  });
  it('blocks owner ABA and disposal while permissions are pending without publishing foreign errors', async () => {
    for (const mode of ['owner', 'dispose']) {
      const f = fixture(); let resolve!: () => void; f.backend.validate.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; })); const opening = f.store.open(hyperCaptureInlineMath(f.state.getState().document, 'p', 2));
      if (mode === 'owner') { useAppStore.setState({ dataDirectory: '/foreign' }); useAppStore.setState({ dataDirectory: '/isolated-inline-math' }); } else f.store.dispose();
      resolve(); await opening; expect(f.store.isCurrent()).toBe(false); expect(f.store.getState().error).toBe(''); expect(f.session.change).not.toHaveBeenCalled();
    }
  });
  it('handles no-op saves without native history actions and cancels with exact original range', async () => {
    const f = fixture(); await f.store.open(hyperCaptureInlineMath(f.state.getState().document, 'p', 3)); expect(await f.store.save()).toEqual({ id: 'p', offset: 4 }); expect(f.session.change.mock.results[0].value.actions).toEqual([]);
    const target = hyperCaptureInlineMathInsertion(f.state.getState().document, { id: 'p', selection: { start: 4, end: 9 } }); await f.store.open(target); f.store.setFormula('draft'); expect(f.store.close()).toEqual({ id: 'p', start: 4, end: 9 }); expect(f.store.getState().status).toBe('idle');
  });
});
