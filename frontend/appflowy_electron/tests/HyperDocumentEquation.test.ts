import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { create, clone } from '@bufbuild/protobuf';
import { createStore } from 'zustand';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { HYPER_MATH_FONT_BASE64, HYPER_MATH_FONT_SHA256, HYPER_MATH_FONT_MARKER } from '@shared/HyperMathFont';
import { hyperBlockData, hyperBlockText, hyperChildren, hyperEditText, hyperInsertBlock, hyperUpdateBlock } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperCaptureDocumentSlash } from '../src/renderer/features/document-slash/HyperDocumentSlashModel';
import { hyperCaptureDocumentEquation, hyperCaptureEquationInsertion, hyperReadDocumentEquation, hyperSaveDocumentEquation } from '../src/renderer/features/document-equation/HyperDocumentEquationModel';
import { hyperRenderEquationMathML } from '../src/renderer/features/document-equation/HyperDocumentEquationMathML';
import { createHyperDocumentEquationStore } from '../src/renderer/features/document-equation/HyperDocumentEquationStore';
import { hyperExportDocument } from '../src/renderer/features/document/HyperDocumentExport';
import { hyperGetDocumentOwner } from '../src/renderer/features/document/HyperDocumentOwner';
import type { HyperDocumentSession } from '../src/renderer/features/document/HyperDocumentSession';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { useAppStore } from '../src/renderer/startup/app-store';
function document() {
  return create(DocumentDataPBSchema, { pageId: 'page', blocks: { page: { id: 'page', ty: 'page', childrenId: 'children', data: '{}' }, p: { id: 'p', parentId: 'page', ty: 'paragraph', childrenId: 'p-children', data: '{"delta":[{"insert":"Original text"}]}' }, math: { id: 'math', parentId: 'page', ty: 'math_equation', childrenId: 'math-children', data: '{"formula":"x^2","unknown":{"keep":true}}' } }, meta: { childrenMap: { children: { children: ['p', 'math'] }, 'p-children': { children: [] }, 'math-children': { children: [] } } } });
}
describe('Hyper pinned equation renderer', () => {
  it('keeps verified font and parser assets with their licenses and provenance', () => {
    expect(crypto.createHash('sha256').update(Buffer.from(HYPER_MATH_FONT_BASE64, 'base64')).digest('hex')).toBe(HYPER_MATH_FONT_SHA256);
    const root = path.resolve(__dirname, '..'), vendor = path.join(root, 'src/renderer/features/document-equation/vendor/katex-0.19.1'), provenance = JSON.parse(fs.readFileSync(path.join(vendor, 'provenance.json'), 'utf8'));
    expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(vendor, 'katex.mjs'))).digest('hex')).toBe(provenance.files['katex.mjs'].sha256); expect(provenance.version).toBe('0.19.1'); expect(fs.readFileSync(path.join(vendor, 'LICENSE'), 'utf8')).toContain('MIT'); expect(fs.readFileSync(path.join(root, 'src/shared/math/STIX-OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE');
  });
  it.each([String.raw`\frac{x^2}{\sqrt y}`, String.raw`\sum_{n=0}^{\infty}x_n`, String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`, String.raw`f(x)=\begin{cases}x&x>0\\-x&x<0\end{cases}`])('renders supported source to native MathML: %s', source => {
    const markup = hyperRenderEquationMathML(source); expect(markup).toContain('<math'); expect(markup).toContain('application/x-tex'); expect(markup).not.toContain('katex-html');
  });
  it.each([String.raw`\cancel{x}`, String.raw`\bcancel{x}`, String.raw`\boxed{x}`, String.raw`\href{javascript:alert(1)}{x}`, String.raw`\includegraphics{https://example.com/x}`, String.raw`\htmlStyle{color:red}{x}`, String.raw`\def\a{\href}\a{https://example.com}{x}`])('explicitly rejects unsupported output instead of silently degrading: %s', source => { expect(() => hyperRenderEquationMathML(source)).toThrow(); });
  it('escapes raw annotation content, bounds expansion/depth and isolates macros between equations', () => {
    const html = hyperRenderEquationMathML(String.raw`\text{</math><img src=x onerror=alert(1)>}`); expect(html).not.toContain('<img'); expect(html).toContain('&lt;');
    expect(() => hyperRenderEquationMathML('x'.repeat(8193))).toThrow('8,192'); expect(() => hyperRenderEquationMathML('{'.repeat(65) + 'x' + '}'.repeat(65))).toThrow('deeply'); expect(() => hyperRenderEquationMathML(String.raw`\def\a{\a}\a`)).toThrow();
    hyperRenderEquationMathML(String.raw`\gdef\auditmacro{x}\auditmacro`); expect(() => hyperRenderEquationMathML(String.raw`\auditmacro`)).toThrow();
  });
});
describe('Hyper equation document edits and export', () => {
  it('preserves unknown metadata and unrelated edits while rejecting changed formulas and block bindings', () => {
    const doc = document(), target = hyperCaptureDocumentEquation(doc, 'math'), updated = hyperEditText(doc, 'p', [{ insert: 'Unrelated edit' }]).document;
    updated.blocks.math.data = '{"formula":"x^2","unknown":{"new":"keep"}}'; const result = hyperSaveDocumentEquation(updated, target, 'y^3'); expect(hyperBlockData(result.document.blocks.math)).toEqual({ formula: 'y^3', unknown: { new: 'keep' } }); expect(hyperBlockText(result.document, result.document.blocks.p)[0].insert).toBe('Unrelated edit');
    const changed = hyperUpdateBlock(doc, 'math', { formula: 'changed' }).document; expect(() => hyperSaveDocumentEquation(changed, target, 'y')).toThrow('changed'); const moved = clone(DocumentDataPBSchema, doc); moved.blocks.math.parentId = 'p'; expect(() => hyperSaveDocumentEquation(moved, target, 'y')).toThrow();
  });
  it('inserts an upstream-compatible leaf block and replaces only a captured slash query', () => {
    const doc = document(), inserted = hyperSaveDocumentEquation(doc, hyperCaptureEquationInsertion(doc, 'p'), String.raw`\frac ab`); const id = inserted.focus!.id; expect(hyperReadDocumentEquation(inserted.document, id)).toBe(String.raw`\frac ab`); expect(hyperChildren(inserted.document, inserted.document.blocks[id])).toEqual([]); expect(hyperBlockText(inserted.document, inserted.document.blocks.p)[0].insert).toBe('Original text');
    const query = hyperEditText(doc, 'p', [{ insert: '/math' }]).document, slash = hyperCaptureDocumentSlash(query, 'p')!, target = hyperCaptureEquationInsertion(query, 'p', slash), result = hyperSaveDocumentEquation(query, target, 'z'); expect(result.document.blocks.p).toBeUndefined(); expect(hyperChildren(result.document, result.document.blocks.page)).toEqual([result.focus!.id, 'math']);
    expect(() => hyperSaveDocumentEquation(hyperEditText(query, 'p', [{ insert: '/math changed' }]).document, target, 'z')).toThrow('slash');
  });
  it('preserves descendants of a slash container and keeps unknown math formats read-only', () => {
    let doc = document(); const child = hyperInsertBlock(doc, 'p', '', 'paragraph'); doc = hyperEditText(child.document, 'p', [{ insert: '/latex' }]).document; const target = hyperCaptureEquationInsertion(doc, 'p', hyperCaptureDocumentSlash(doc, 'p')!); const result = hyperSaveDocumentEquation(doc, target, 'x'); expect(hyperChildren(result.document, result.document.blocks.p)).toEqual([child.focus!.id]); expect(hyperBlockText(result.document, result.document.blocks.p)).toEqual([]);
    const bad = document(); bad.blocks.math.data = '{"formula":42,"unknown":"kept"}'; expect(() => hyperCaptureDocumentEquation(bad, 'math')).toThrow('format'); expect(bad.blocks.math.data).toContain('kept');
  });
  it('exports one font face with independent family/spacing CSS and keeps invalid source available as raw Markdown', () => {
    const doc = document(), additional = hyperInsertBlock(doc, 'page', 'math', 'math_equation', { formula: String.raw`\sqrt{x}` }); const html = hyperExportDocument(additional.document, 'html'); expect(html.match(/data-hyper-math-font=/gu)).toHaveLength(1); expect(html).toContain(HYPER_MATH_FONT_MARKER); expect(html).toContain('margin:1rem 0'); expect(html).toContain('font-family:');
    const invalid = hyperUpdateBlock(doc, 'math', { formula: String.raw`\boxed{x}` }).document; expect(() => hyperExportDocument(invalid, 'html')).toThrow('unsupported MathML'); expect(hyperExportDocument(invalid, 'markdown')).toContain('$$\n\\boxed{x}\n$$'); const delimiter = hyperUpdateBlock(doc, 'math', { formula: 'x\n$$\ny' }).document; expect(() => hyperExportDocument(delimiter, 'markdown')).toThrow('delimiter');
  });
});
const previousApp = useAppStore.getState(), previousWorkspace = useWorkspaceStore.getState();
beforeEach(() => { useAppStore.setState({ dataDirectory: '/isolated-equation-tests' }); useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 1n }), currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace' }), actionResult: null }); });
afterEach(() => { useAppStore.setState(previousApp, true); useWorkspaceStore.setState(previousWorkspace, true); });
function storeFixture() {
  const state = createStore(() => ({ document: document(), status: 'ready', historyPending: false, error: null }));
  const session = { id: 'document', store: state, belongsTo: () => true, isCurrentOwner: () => true, flush: vi.fn(async () => {}), refresh: vi.fn(async () => {}), change: vi.fn((build: (doc: DocumentDataPB) => { document: DocumentDataPB; focus?: { id: string; offset: number } }) => { const result = build(state.getState().document); state.setState({ document: result.document }); return result; }) };
  let editable = true; const backend = { validate: vi.fn(async () => {}) }, store = createHyperDocumentEquationStore({ session: session as unknown as HyperDocumentSession, owner: hyperGetDocumentOwner()!, editable: () => editable }, backend);
  return { state, session, backend, store, readOnly: () => { editable = false; } };
}
describe('Hyper guarded equation saves', () => {
  it('validates fresh permissions and formula before saving, without changing unrelated data', async () => {
    const f = storeFixture(); await f.store.open(hyperCaptureDocumentEquation(f.state.getState().document, 'math')); f.store.setFormula('y^2'); expect(await f.store.save()).toMatchObject({ id: 'math' }); expect(f.backend.validate).toHaveBeenCalledTimes(3); expect(hyperBlockData(f.state.getState().document.blocks.math).unknown).toEqual({ keep: true });
  });
  it('blocks owner ABA, permission loss and stale formulas before any native mutation', async () => {
    for (const mode of ['owner', 'permissions', 'stale']) {
      const f = storeFixture(); await f.store.open(hyperCaptureDocumentEquation(f.state.getState().document, 'math')); f.store.setFormula('y');
      if (mode === 'owner') { useAppStore.setState({ dataDirectory: '/another-realm' }); useAppStore.setState({ dataDirectory: '/isolated-equation-tests' }); }
      if (mode === 'permissions') f.readOnly(); if (mode === 'stale') f.state.setState({ document: hyperUpdateBlock(f.state.getState().document, 'math', { formula: 'Changed elsewhere' }).document });
      expect(await f.store.save()).toBeUndefined(); expect(f.session.change).not.toHaveBeenCalled();
    }
  });
  it('retains an uncertain insert source and does not replay it after a failed flush', async () => {
    const f = storeFixture(); await f.store.open(hyperCaptureEquationInsertion(f.state.getState().document, 'p')); f.store.setFormula('x^2'); f.session.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Native save acknowledgment lost'));
    await f.store.save(); expect(f.store.getState()).toMatchObject({ status: 'partial', formula: 'x^2' }); await f.store.save(); expect(f.session.change).toHaveBeenCalledTimes(1); expect(hyperChildren(f.state.getState().document, f.state.getState().document.blocks.page)).toHaveLength(3);
  });
});
