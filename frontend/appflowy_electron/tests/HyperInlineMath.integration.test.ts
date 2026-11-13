import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ApplyActionPayloadPBSchema, ConvertDataPayloadPBSchema, CreateDocumentPayloadPBSchema, DocumentDataPBSchema, DocumentRedoUndoPayloadPBSchema,
  DocumentRedoUndoResponsePBSchema, OpenDocumentPayloadPBSchema, TextDeltaPayloadPBSchema,
  type DocumentDataPB,
} from '@shared/protobuf/flowy-document/entities_pb';
import { CreateViewPayloadPBSchema, DuplicateViewPayloadPBSchema, RepeatedViewPBSchema, ViewIdPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { ImportPayloadPBSchema, ImportTypePB } from '@shared/protobuf/flowy-folder/import_pb';
import { WorkspaceLatestPBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { DatabasePBSchema, DatabaseViewIdPBSchema } from '@shared/protobuf/flowy-database2/database_entities_pb';
import { DatabaseViewRowIdPBSchema, RowMetaPBSchema, UpdateRowMetaChangesetPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';
import {
  hyperChildren, hyperEditText, type HyperDocumentChange, type HyperTextRun,
} from '../src/renderer/features/document/HyperDocumentModel';
import {
  hyperCaptureInlineMath, hyperCaptureInlineMathInsertion, hyperSaveInlineMath, hyperUnwrapInlineMath,
} from '../src/renderer/features/document-inline-math/HyperInlineMathModel';

import { HyperDocumentSession } from '../src/renderer/features/document/HyperDocumentSession';
import { hyperGetDocumentOwner } from '../src/renderer/features/document/HyperDocumentOwner';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { createHyperInlineMathStore, type HyperInlineMathStore } from '../src/renderer/features/document-inline-math/HyperInlineMathStore';
import { hyperExportDocument } from '../src/renderer/features/document/HyperDocumentExport';
import { markdownToEditorJson } from '../src/renderer/features/sidebar/import/markdown';

const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);

/** Inspect the core's saved JSON, independently of the inline-math decoder. */
function rawRuns(doc: DocumentDataPB, blockId: string): HyperTextRun[] {
  const block = doc.blocks[blockId];
  if (block.oneOfExternalId.case !== 'externalId') throw Error('Native paragraph has no external text.');
  return JSON.parse(doc.meta!.textMap[block.oneOfExternalId.value]) as HyperTextRun[];
}

describe('Hyper inline math through the real document core', () => {
  let support = '', workspaceId = '', core: CoreProcess;
  const events: string[] = [], sessions: HyperDocumentSession[] = [], stores: HyperInlineMathStore[] = [];
  const initialWorkspace = useWorkspaceStore.getState();
  const deviceId = `hyper-inline-math-${randomUUID()}`;
  const cleared = Object.fromEntries(Object.keys(process.env).map(key => [key, undefined]));
  const makeCore = () => new CoreProcess(binary, () => ({
    ...cleared, PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', TMPDIR: support,
  }));

  async function request(event: string, input?: [DescMessage, object]) {
    events.push(event);
    const reply = await core.request(event, input
      ? toBinary(input[0], create(input[0], input[1] as MessageInitShape<DescMessage>))
      : new Uint8Array());
    if (reply.status !== Status.Ok) throw Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    return reply.payload;
  }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) {
    return fromBinary(output, await request(event, input));
  }
  async function start() {
    await core.start(() => {});
    expect(await core.init({
      root: support, custom_app_path: support, origin_app_path: support,
      app_version: '0.11.4', device_id: deviceId, platform: process.platform, authenticator_type: 0,
      appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {},
    })).toBe(0);
  }
  async function restart() { await core.stop(); core = makeCore(); await start(); }
  const read = (documentId: string) => call('GetDocumentData', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId }]);
  async function page(name: string) {
    const view = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, {
      parentViewId: workspaceId, name, layout: ViewLayoutPB.Document,
    }]);
    const doc = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: view.id }]);
    const blockId = hyperChildren(doc, doc.blocks[doc.pageId])[0];
    expect(blockId).toBeDefined();
    return { view, doc, blockId };
  }
  async function commit(documentId: string, change: HyperDocumentChange) {
    if (change.actions.length) await request('ApplyAction', [ApplyActionPayloadPBSchema, { documentId, actions: change.actions }]);
    return read(documentId);
  }

  beforeAll(async () => {
    expect(fs.existsSync(binary), 'Build the Rust core before running native integration tests.').toBe(true);
    support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-inline-math-core-'));
    core = makeCore(); await start();
    // Match the production local guest flow, with disposable credentials only.
    await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, {
      email: 'anon@appflowy.io', name: 'Inline math fixture', password: 'FakeInlineMathFixtureOnly!',
      authType: AuthTypePB.Local, deviceId,
    }]);
    workspaceId = (await call('GetCurrentWorkspaceSetting', WorkspaceLatestPBSchema)).workspaceId;
  }, 20_000);
  afterAll(async () => {
    for (const store of stores) store.dispose();
    for (const session of sessions) await session.dispose();
    await core?.stop();
    useWorkspaceStore.setState({ userProfile: initialWorkspace.userProfile, currentWorkspace: initialWorkspace.currentWorkspace, actionResult: initialWorkspace.actionResult });
    vi.unstubAllGlobals();
    if (support) fs.rmSync(support, { recursive: true, force: true });
  });

  it('inserts, edits and unwraps exact TeX with native UTF-16 offsets and opaque marks', async () => {
    const { view, doc, blockId } = await page('Inline math selection');
    const opaque = { z: ['keep', 42], a: { exact: true } };
    const seeded = await commit(view.id, hyperEditText(doc, blockId, [
      { insert: '🌍 ' }, { insert: 'x+y', attributes: { bold: true, opaque } },
      { insert: ' tail 😀', attributes: { italic: true } },
    ]));
    const anchor = hyperCaptureInlineMathInsertion(seeded, { id: blockId, selection: { start: 3, end: 6 } });
    const inserted = hyperSaveInlineMath(seeded, anchor, String.raw`\alpha + 1`);
    expect(inserted.focus).toEqual({ id: blockId, offset: 4 });
    // Capture from the optimistic model, then save against a fresh Yrs read.
    // Attribute-key reordering by native JSON must not create a stale anchor.
    const target = hyperCaptureInlineMath(inserted.document, blockId, 3);
    const persisted = await commit(view.id, inserted);
    expect(rawRuns(persisted, blockId)).toEqual([
      { insert: '🌍 ' }, { insert: '$', attributes: { bold: true, opaque, formula: String.raw`\alpha + 1` } },
      { insert: ' tail 😀', attributes: { italic: true } },
    ]);
    const edited = await commit(view.id, hyperSaveInlineMath(persisted, target, String.raw`\frac{α}{β}`));
    const unwrapped = hyperUnwrapInlineMath(edited, hyperCaptureInlineMath(edited, blockId, 3));
    expect(unwrapped.focus).toEqual({ id: blockId, offset: 14 });
    expect(rawRuns(await commit(view.id, unwrapped), blockId)).toEqual([
      { insert: '🌍 ' }, { insert: String.raw`\frac{α}{β}`, attributes: { bold: true, opaque } },
      { insert: ' tail 😀', attributes: { italic: true } },
    ]);
  });

  it('edits one native-merged dollar atom and preserves its sibling through Undo, Redo and restart', async () => {
    const { view, doc, blockId } = await page('Native merged inline math');
    const initial = await commit(view.id, hyperEditText(doc, blockId, [
      { insert: '🌍 ' }, { insert: ' 🎈', attributes: { italic: true } },
    ]));
    const textId = initial.blocks[blockId].oneOfExternalId.value;
    const attrs = { formula: 'a_{🌍}+b', bold: true, opaque: { kind: 'native', nested: [1, { z: true, a: 'value' }] } };
    // A saved multi-character run still represents two one-character atoms.
    // Native runs with equal JSON attributes need not coalesce.
    await request('ApplyTextDeltaEvent', [TextDeltaPayloadPBSchema, {
      documentId: view.id, textId,
      oneOfDelta: { case: 'delta', value: JSON.stringify([{ retain: 3 }, { insert: '$$', attributes: attrs }]) },
    }]);
    const original = [
      { insert: '🌍 ' }, { insert: '$$', attributes: attrs }, { insert: ' 🎈', attributes: { italic: true } },
    ];
    expect(rawRuns(await read(view.id), blockId)).toEqual(original);

    // A fresh core loads the actual saved state with a fresh undo stack. This
    // separates the edit from seeding without capture-window timing sleeps.
    await restart();
    const opened = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: view.id }]);
    expect(rawRuns(opened, blockId)).toEqual(original);
    expect((await call('CanUndoRedo', DocumentRedoUndoResponsePBSchema, [DocumentRedoUndoPayloadPBSchema, { documentId: view.id }])).canUndo).toBe(false);
    const changed = hyperSaveInlineMath(opened, hyperCaptureInlineMath(opened, blockId, 4), String.raw`\beta_2`);
    expect(changed.focus).toEqual({ id: blockId, offset: 5 });
    const edited = [
      { insert: '🌍 ' }, { insert: '$', attributes: attrs },
      { insert: '$', attributes: { ...attrs, formula: String.raw`\beta_2` } },
      { insert: ' 🎈', attributes: { italic: true } },
    ];
    expect(rawRuns(await commit(view.id, changed), blockId)).toEqual(edited);
    expect((await call('Undo', DocumentRedoUndoResponsePBSchema, [DocumentRedoUndoPayloadPBSchema, { documentId: view.id }])).isSuccess).toBe(true);
    expect(rawRuns(await read(view.id), blockId)).toEqual(original);
    expect((await call('Redo', DocumentRedoUndoResponsePBSchema, [DocumentRedoUndoPayloadPBSchema, { documentId: view.id }])).isSuccess).toBe(true);
    const redone = await read(view.id);
    expect(rawRuns(redone, blockId)).toEqual(edited);

    const unwrap = hyperUnwrapInlineMath(redone, hyperCaptureInlineMath(redone, blockId, 3));
    // 'a_{🌍}+b' occupies eight UTF-16 units, following the three-unit prefix.
    expect(unwrap.focus).toEqual({ id: blockId, offset: 11 });
    const unwrapped = await commit(view.id, unwrap);
    expect(rawRuns(unwrapped, blockId)).toEqual([
      { insert: '🌍 ' }, { insert: 'a_{🌍}+b', attributes: { bold: true, opaque: attrs.opaque } },
      { insert: '$', attributes: { ...attrs, formula: String.raw`\beta_2` } },
      { insert: ' 🎈', attributes: { italic: true } },
    ]);
    expect(hyperCaptureInlineMath(unwrapped, blockId, 11).read.formula).toBe(String.raw`\beta_2`);
    await restart();
    expect(rawRuns(await read(view.id), blockId)).toEqual(rawRuns(unwrapped, blockId));
  }, 25_000);
  it('copies saved source and future math attributes without changing either document', async () => {
    const { view, doc, blockId } = await page('Raw inline math copy source');
    const sourceRuns: HyperTextRun[] = [
      { insert: '🧭 ' },
      { insert: '$$', attributes: { formula: String.raw`\sqrt{λ}`, opaque: { full: ['source', 7] } } },
      { insert: ' / ' },
      { insert: '$', attributes: { formula: { version: 2, source: 'future+🌍', opaque: { retained: true } }, underline: true } },
      { insert: ' / ' },
      { insert: '$', attributes: { formula: 'linked+x', href: 'https://example.invalid/kept', unknown: ['keep'] } },
      { insert: ' literal $$' },
    ];
    const saved = await commit(view.id, hyperEditText(doc, blockId, sourceRuns));
    expect(rawRuns(saved, blockId)).toEqual(sourceRuns);
    // Future/conflicting source is still real native data. The math model must
    // decline edits without dispatching an action or converting that source.
    for (const offset of [8, 12]) {
      const target = hyperCaptureInlineMath(saved, blockId, offset);
      expect(target.editable).toBe(false);
      expect(() => hyperSaveInlineMath(saved, target, 'replacement')).toThrow();
      expect(() => hyperUnwrapInlineMath(saved, target)).toThrow();
    }
    const copied = await call('DuplicateView', ViewPBSchema, [DuplicateViewPayloadPBSchema, {
      viewId: view.id, includeChildren: false, openAfterDuplicate: false, syncAfterCreate: true,
    }]);
    expect(copied.id).not.toBe(view.id);
    const opened = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: copied.id }]);
    const copiedBlock = hyperChildren(opened, opened.blocks[opened.pageId])[0];
    expect(rawRuns(opened, copiedBlock)).toEqual(sourceRuns);
    expect((await call('CanUndoRedo', DocumentRedoUndoResponsePBSchema, [DocumentRedoUndoPayloadPBSchema, { documentId: copied.id }])).canUndo).toBe(false);
    expect(rawRuns(await read(view.id), blockId)).toEqual(sourceRuns);
    await restart();
    expect(rawRuns(await read(view.id), blockId)).toEqual(sourceRuns);
    expect(rawRuns(await read(copied.id), copiedBlock)).toEqual(sourceRuns);
  }, 25_000);

  it('imports portable Markdown math through native conversion and preserves exact source after restart', async () => {
    const { view, doc, blockId } = await page('Inline math portable source');
    const formula = '\\frac{🌍}{β}\n+ $literal$ + [^not-a-footnote] + <span> & "quote"';
    const sourceRuns: HyperTextRun[] = [
      { insert: '🌍 ' },
      { insert: '$$', attributes: { formula, bold: true, opaque: { nested: [{ keep: true }, 'TeX source'], custom: 41 } } },
      { insert: ' ' }, { insert: 'literal $$', attributes: { italic: true } },
    ];
    const saved = await commit(view.id, hyperEditText(doc, blockId, sourceRuns));
    expect(rawRuns(saved, blockId)).toEqual(sourceRuns);
    const markdown = hyperExportDocument(saved, 'markdown');
    expect(markdown.match(/data-hyper-inline-math-source=/gu)).toHaveLength(2);
    const converted = await call('ConvertDataToDocument', DocumentDataPBSchema, [ConvertDataPayloadPBSchema, {
      convertType: 0, data: new TextEncoder().encode(JSON.stringify(markdownToEditorJson(markdown))),
    }]);
    const convertedBlock = hyperChildren(converted, converted.blocks[converted.pageId])[0];
    expect(rawRuns(converted, convertedBlock)).toEqual(sourceRuns);
    const imported = await call('ImportData', RepeatedViewPBSchema, [ImportPayloadPBSchema, {
      parentViewId: workspaceId,
      items: [{ name: 'Portable inline math imported', viewLayout: ViewLayoutPB.Document,
        importType: ImportTypePB.Markdown, oneOfData: { case: 'data', value: toBinary(DocumentDataPBSchema, converted) } }],
    }]);
    expect(imported.items).toHaveLength(1);
    const importedId = imported.items[0].id;
    await restart();
    const reopened = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: importedId }]);
    const importedBlock = hyperChildren(reopened, reopened.blocks[reopened.pageId])[0];
    expect(rawRuns(reopened, importedBlock)).toEqual(sourceRuns);
    // Converted/imported source is editable native math, rather than visible
    // marker text or a rendered approximation of the original formula.
    const changed = await commit(importedId, hyperSaveInlineMath(reopened, hyperCaptureInlineMath(reopened, importedBlock, 4), 'new+β'));
    expect(rawRuns(changed, importedBlock)).toEqual([
      sourceRuns[0], { insert: '$', attributes: sourceRuns[1].attributes },
      { insert: '$', attributes: { ...sourceRuns[1].attributes, formula: 'new+β' } }, ...sourceRuns.slice(2),
    ]);
    expect(rawRuns(await read(view.id), blockId)).toEqual(sourceRuns);
  }, 25_000);

  it('validates native page and dataset locks plus exact row-body binding before saving', async () => {
    // Replace only the preload transport with the actual typed CoreProcess wire.
    vi.stubGlobal('window', { appflowy: { core: {
      request: (event: string, bytes: Uint8Array) => { events.push(event); return core.request(event, bytes); },
      onNotification: () => () => {},
    } } });
    const user = await call('GetUserProfile', UserProfilePBSchema);
    useWorkspaceStore.setState({ userProfile: user, currentWorkspace: create(UserWorkspacePBSchema, {
      workspaceId, workspaceType: WorkspaceTypePB.LocalW,
    }), actionResult: null });
    const owner = hyperGetDocumentOwner()!;
    const applyCount = () => events.filter(event => event === 'ApplyAction').length;
    const sessionFor = async (id: string) => {
      const session = new HyperDocumentSession(id, undefined, owner); sessions.push(session);
      await session.flush(); expect(session.store.getState().status).toBe('ready'); return session;
    };
    const pageSource = await page('Inline math locked page');
    await commit(pageSource.view.id, hyperEditText(pageSource.doc, pageSource.blockId, [{ insert: 'page source' }]));
    const pageSession = await sessionFor(pageSource.view.id);
    const pageStore = createHyperInlineMathStore({ session: pageSession, owner, editable: () => true }); stores.push(pageStore);
    await pageStore.open(hyperCaptureInlineMathInsertion(pageSession.store.getState().document!, {
      id: pageSource.blockId, selection: { start: 0, end: 4 },
    }));
    expect(pageStore.getState().status).toBe('editing'); pageStore.setFormula('page+α');
    await request('LockView', [ViewIdPBSchema, { value: pageSource.view.id }]);
    const beforePageLock = applyCount();
    expect(await pageStore.save()).toBeUndefined();
    expect(pageStore.getState().error).toMatch(/locked/i);
    expect(applyCount()).toBe(beforePageLock);
    expect(rawRuns(await read(pageSource.view.id), pageSource.blockId)).toEqual([{ insert: 'page source' }]);
    await request('UnlockView', [ViewIdPBSchema, { value: pageSource.view.id }]);
    expect(await pageStore.save(), pageStore.getState().error).toEqual({ id: pageSource.blockId, offset: 1 });
    const pageRuns = [{ insert: '$', attributes: { formula: 'page+α' } }, { insert: ' source' }];
    expect(rawRuns(await read(pageSource.view.id), pageSource.blockId)).toEqual(pageRuns);

    const grid = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, {
      parentViewId: workspaceId, name: 'Inline math row bodies', layout: ViewLayoutPB.Grid,
    }]);
    const database = await call('GetDatabase', DatabasePBSchema, [DatabaseViewIdPBSchema, { value: grid.id }]);
    expect(database.rows.length).toBeGreaterThan(1);
    const row = await call('GetRowMeta', RowMetaPBSchema, [DatabaseViewRowIdPBSchema, { viewId: grid.id, rowId: database.rows[0].id }]);
    expect(row.oneOfDocumentId.case).toBe('documentId');
    const rowDocumentId = row.oneOfDocumentId.value as string;
    await request('CreateDocument', [CreateDocumentPayloadPBSchema, { documentId: rowDocumentId }]);
    await request('UpdateRowMeta', [UpdateRowMetaChangesetPBSchema, {
      viewId: grid.id, id: row.id, oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: false },
    }]);
    const body = await call('OpenDocument', DocumentDataPBSchema, [OpenDocumentPayloadPBSchema, { documentId: rowDocumentId }]);
    const bodyBlock = hyperChildren(body, body.blocks[body.pageId])[0];
    await commit(rowDocumentId, hyperEditText(body, bodyBlock, [{ insert: '🌍 row body' }]));
    const rowSession = await sessionFor(rowDocumentId);
    const anchor = hyperCaptureInlineMathInsertion(rowSession.store.getState().document!, { id: bodyBlock, selection: { start: 3, end: 6 } });
    const wrong = createHyperInlineMathStore({ session: rowSession, owner, editable: () => true,
      rowScope: { viewId: grid.id, rowId: database.rows[1].id } }); stores.push(wrong);
    const beforeWrongRow = applyCount(); await wrong.open(anchor);
    expect(wrong.getState().status).toBe('error');
    expect(wrong.getState().error).toMatch(/row document changed|removed/i);
    expect(await wrong.save()).toBeUndefined(); expect(applyCount()).toBe(beforeWrongRow);
    const rowStore = createHyperInlineMathStore({ session: rowSession, owner, editable: () => true,
      rowScope: { viewId: grid.id, rowId: row.id } }); stores.push(rowStore);
    await rowStore.open(anchor); expect(rowStore.getState().status).toBe('editing'); rowStore.setFormula('row+β');
    await request('LockView', [ViewIdPBSchema, { value: grid.id }]);
    const beforeGridLock = applyCount();
    expect(await rowStore.save()).toBeUndefined(); expect(rowStore.getState().error).toMatch(/locked/i);
    expect(applyCount()).toBe(beforeGridLock);
    expect(rawRuns(await read(rowDocumentId), bodyBlock)).toEqual([{ insert: '🌍 row body' }]);
    await request('UnlockView', [ViewIdPBSchema, { value: grid.id }]);
    expect(await rowStore.save(), rowStore.getState().error).toEqual({ id: bodyBlock, offset: 4 });
    const bodyRuns = [{ insert: '🌍 ' }, { insert: '$', attributes: { formula: 'row+β' } }, { insert: ' body' }];
    expect(rawRuns(await read(rowDocumentId), bodyBlock)).toEqual(bodyRuns);
    for (const store of stores.splice(0)) store.dispose();
    for (const session of sessions.splice(0)) await session.dispose();
    await restart();
    expect(rawRuns(await read(pageSource.view.id), pageSource.blockId)).toEqual(pageRuns);
    expect(rawRuns(await read(rowDocumentId), bodyBlock)).toEqual(bodyRuns);
  }, 30_000);

});
