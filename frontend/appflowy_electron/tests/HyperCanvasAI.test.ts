import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { AIModelPBSchema, CompleteTextTaskPBSchema, ModelSelectionPBSchema, type CompleteTextTaskPB } from '@shared/protobuf/flowy-ai/entities_pb';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { HyperDocumentSession, type HyperDocumentBackend } from '../src/renderer/features/document/HyperDocumentSession';
import { hyperEditText, hyperInsertBlock } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperCanvasLabel, hyperEditCanvasLabel, hyperInsertCanvasElement, hyperReadCanvas } from '../src/renderer/features/whiteboard/HyperWhiteboardModel';
import { hyperCanvasFrameContents } from '../src/renderer/features/whiteboard/HyperWhiteboardFeatures';
import { hyperAssertCanvasAISource, hyperBuildCanvasAI, hyperCanvasAIPreview, hyperCanvasAIPrompt, hyperCaptureCanvasAISource, hyperParseCanvasAIResult, hyperWrapCanvasAIText } from '../src/renderer/features/canvas-ai/HyperCanvasAIModel';
import { createHyperCanvasAIStore, hyperCanvasAIRequest, type HyperCanvasAIBackend } from '../src/renderer/features/canvas-ai/HyperCanvasAIStore';

const doc = () => create(DocumentDataPBSchema, { pageId: 'document', blocks: { document: { id: 'document', ty: 'page', childrenId: 'root-children', data: '{}' } }, meta: { childrenMap: { 'root-children': { children: [] } } } });
const mindmap = { version: 1 as const, root: { text: 'Root', children: [{ text: 'Child', children: [] }] } };
const slides = { version: 1 as const, slides: [{ title: 'Title', bullets: ['Point'] }] };
describe('Hyper Canvas AI result validation and local layout', () => {
  it('accepts only bounded JSON shapes and rejects markup, extra fields and invalid labels', () => {
    expect(hyperParseCanvasAIResult(JSON.stringify(mindmap), 'mindmap')).toEqual(mindmap);
    expect(hyperParseCanvasAIResult(JSON.stringify(slides), 'presentation')).toEqual(slides);
    for (const raw of ['```json\n' + JSON.stringify(mindmap) + '\n```', '{}', JSON.stringify({ ...mindmap, url: 'https://example.org' }), JSON.stringify({ version: 1, root: { ...mindmap.root, x: 1 } }), JSON.stringify({ version: 1, root: { text: ' bad', children: [] } }), JSON.stringify({ version: 1, root: { text: 'bad\nlabel', children: [] } }), JSON.stringify({ version: 1, root: { text: 'a'.repeat(121), children: [] } })]) expect(() => hyperParseCanvasAIResult(raw, 'mindmap')).toThrow();
    expect(() => hyperParseCanvasAIResult(' '.repeat(32769), 'mindmap')).toThrow('size limit');
    expect(() => hyperParseCanvasAIResult(JSON.stringify({ ...slides, slides: [{ title: 'T', bullets: ['x'], image: 'file:///private' }] }), 'presentation')).toThrow();
    expect(() => hyperParseCanvasAIResult(JSON.stringify({ version: 1, slides: [] }), 'presentation')).toThrow();
    expect(() => hyperParseCanvasAIResult(JSON.stringify({ version: 1, slides: Array(13).fill(slides.slides[0]) }), 'presentation')).toThrow();
    expect(() => hyperParseCanvasAIResult(JSON.stringify({ version: 1, slides: [{ title: 'T', bullets: Array(7).fill('x') }] }), 'presentation')).toThrow();
    expect(() => hyperParseCanvasAIResult(JSON.stringify({ version: 1, slides: [{ title: 'T', bullets: ['x'.repeat(161)] }] }), 'presentation')).toThrow();
  });
  it('bounds topic count and recursion before layout', () => {
    expect(() => hyperParseCanvasAIResult(JSON.stringify({ version: 1, root: { text: 'R', children: Array.from({ length: 64 }, () => ({ text: 'C', children: [] })) } }), 'mindmap')).toThrow();
    let root: { text: string; children: typeof root[] } = { text: 'R', children: [] };
    for (let i = 0; i < 7; i++) root = { text: 'R', children: [root] };
    expect(() => hyperParseCanvasAIResult(JSON.stringify({ version: 1, root }), 'mindmap')).toThrow();
  });
  it('wraps complete Unicode labels within renderer limits and keeps slides within frames', () => {
    const result = { version: 1 as const, slides: [{ title: '🌍'.repeat(120), bullets: Array(6).fill('🌎'.repeat(160)) }] };
    const preview = hyperCanvasAIPreview(result), elements = hyperReadCanvas(preview).elements;
    const frame = elements.find(item => item.kind === 'frame')!;
    expect(hyperCanvasFrameContents(frame, elements)).toHaveLength(7);
    const text = elements.filter(item => item.kind === 'text');
    for (const item of text) {
      expect(item.text.split('\n').every(line => line.length <= Math.floor(item.width / 8))).toBe(true);
      expect(item.text.split('\n').length * 20 + 4).toBeLessThanOrEqual(item.height);
      expect(item.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
    }
    expect(text[0].text.replaceAll('\n', '')).toBe(result.slides[0].title);
    expect(text[1].text.replaceAll('\n', '')).toBe('• ' + result.slides[0].bullets[0]);
    for (let i = 1; i < text.length - 1; i++) expect(text[i].y + text[i].height).toBeLessThan(text[i + 1].y);
    const map = hyperCanvasAIPreview({ version: 1, root: { text: '🌍'.repeat(120), children: [{ text: 'Child', children: [] }] } });
    const notes = hyperReadCanvas(map).elements.filter(item => item.kind === 'note');
    expect(hyperCanvasLabel(notes[0], map).replaceAll('\n', '')).toBe('🌍'.repeat(120));
    expect(notes[0].height + notes[0].y).toBeLessThan(notes[1].y);
    expect(() => hyperWrapCanvasAIText('x', 0)).toThrow();
  });
  it('generates local IDs and appends without replacing unrelated canvas elements', () => {
    const base = hyperInsertCanvasElement(doc(), 'rectangle', { x: 200, y: 100, width: 300, height: 200 });
    const result = hyperBuildCanvasAI(base.document, mindmap), elements = hyperReadCanvas(result.document).elements;
    expect(result.document.blocks[base.focus!.id]).toEqual(base.document.blocks[base.focus!.id]);
    expect(elements.filter(item => item.kind === 'note').every(item => item.x >= 564)).toBe(true);
    expect(elements.find(item => item.kind === 'connector')).toMatchObject({ fromId: result.focus!.id });
    expect(hyperReadCanvas(base.document).elements).toHaveLength(1);
  });
  it('includes only opted-in sources, catches changed selected labels and bounds source input', () => {
    const note = hyperInsertCanvasElement(doc(), 'note', { x: 0, y: 0, width: 200, height: 80 }, { text: 'Private note' });
    const omitted = hyperCaptureCanvasAISource(note.document, { selectedIds: [note.focus!.id], includePage: false, includeSelected: false });
    expect(omitted.text).toBe('');
    const selected = hyperCaptureCanvasAISource(note.document, { selectedIds: [note.focus!.id], includePage: false, includeSelected: true });
    expect(selected.text).toContain('Private note');
    const changed = hyperEditCanvasLabel(note.document, note.focus!.id, 'Edited');
    expect(() => hyperAssertCanvasAISource(changed.document, selected, [note.focus!.id])).toThrow('source changed');
    expect(() => hyperAssertCanvasAISource(note.document, selected, [])).toThrow();
    expect(() => hyperCaptureCanvasAISource(doc(), { selectedIds: [], includePage: false, includeSelected: true })).toThrow();
    const paragraph = hyperInsertBlock(doc(), 'document', '', 'paragraph');
    const oversized = hyperEditText(paragraph.document, paragraph.focus!.id, [{ insert: 'x'.repeat(16385) }]);
    expect(() => hyperCaptureCanvasAISource(oversized.document, { selectedIds: [], includePage: true, includeSelected: false })).toThrow('16,384');
  });
  it('uses the real document ID, custom prompt and bounded user instruction', () => {
    const request = hyperCanvasAIRequest({ documentId: 'real-document-uuid', kind: 'mindmap', instruction: 'Plan a release', source: '', port: 42n });
    expect(request.objectId).toBe('real-document-uuid'); expect(request.streamPort).toBe(42n);
    expect(request.oneOfCustomPrompt.value).toContain('no additional fields');
    expect(() => hyperCanvasAIPrompt('mindmap', 'x'.repeat(2001), '')).toThrow('2,000');
  });
});

async function fixture() {
  let saved = doc(), active = true, editable = true, ids: string[] = [];
  const owner = { workspaceId: 'workspace', actorId: 'actor', contextKey: 'context', isCurrent: () => active };
  const documentBackend: HyperDocumentBackend = { open: async () => saved, read: async () => saved, apply: vi.fn(async () => { saved = session.store.getState().document!; }), close: async () => {}, history: async () => {}, listen: () => () => {} };
  const session = new HyperDocumentSession('document', documentBackend, owner); await session.flush();
  let listener: (value: unknown) => void = () => {};
  const close = vi.fn();
  const model = create(AIModelPBSchema, { name: 'Text model' });
  const backend: HyperCanvasAIBackend = { complete: vi.fn(async () => create(CompleteTextTaskPBSchema, { taskId: 'task' })), stop: vi.fn(async () => {}), models: vi.fn(async () => create(ModelSelectionPBSchema, { models: [model], selectedModel: model })), selectModel: vi.fn(async () => {}), openPort: callback => { listener = callback; return { port: 42n, close }; } };
  const store = createHyperCanvasAIStore({ session, owner, editable: () => editable, selectedIds: () => ids, currentOwner: () => active ? owner : null }, backend);
  store.start();
  const generate = () => store.generate('mindmap', 'Create a plan', { includePage: false, includeSelected: false, selectedIds: [] });
  const finish = (raw = JSON.stringify(mindmap)) => { listener('data:' + raw); listener('finish:'); };
  return { store, session, backend, documentBackend, generate, finish, emit: (value: string) => listener(value), close, model, deactivate: () => { active = false; }, lock: () => { editable = false; }, select: (next: string[]) => { ids = next; } };
}
describe('Hyper Canvas AI lifecycle and explicit apply', () => {
  it('opens without generation, previews without writes and appends once to the latest document', async () => {
    const f = await fixture(); expect(f.backend.complete).not.toHaveBeenCalled();
    await f.generate(); f.finish(); expect(f.store.getState().status).toBe('ready');
    expect(f.documentBackend.apply).not.toHaveBeenCalled(); expect(hyperReadCanvas(f.session.store.getState().document!).elements).toHaveLength(0);
    const unrelated = f.session.change(doc => hyperInsertCanvasElement(doc, 'rectangle', { x: 10, y: 20, width: 200, height: 80 }))!;
    const apply = f.store.apply(); await expect(f.store.apply()).rejects.toThrow('Generate and review'); await apply;
    expect(hyperReadCanvas(f.session.store.getState().document!).elements).toHaveLength(4);
    expect(f.session.store.getState().document!.blocks[unrelated.focus!.id]).toBeDefined();
    await expect(f.store.apply()).rejects.toThrow('Generate and review'); f.store.dispose(); await f.session.dispose();
  });
  it.each(['lock', 'owner'] as const)('rejects apply after %s changes', async reason => {
    const f = await fixture(); await f.generate(); f.finish(); reason === 'lock' ? f.lock() : f.deactivate();
    await expect(f.store.apply()).rejects.toThrow(); expect(f.documentBackend.apply).not.toHaveBeenCalled(); f.store.dispose(); await f.session.dispose();
  });
  it('rejects changed included source while retaining concurrent edits', async () => {
    const f = await fixture();
    const note = f.session.change(doc => hyperInsertCanvasElement(doc, 'note', { x: 0, y: 0, width: 200, height: 80 }, { text: 'Original' }))!;
    await f.session.flush(); f.select([note.focus!.id]);
    await f.store.generate('mindmap', 'Create', { includePage: false, includeSelected: true, selectedIds: [note.focus!.id] }); f.finish();
    f.session.change(doc => hyperEditCanvasLabel(doc, note.focus!.id, 'Concurrent edit')); await f.session.flush();
    await expect(f.store.apply()).rejects.toThrow('source changed');
    const document = f.session.store.getState().document!; expect(hyperReadCanvas(document).elements).toHaveLength(1); expect(hyperCanvasLabel(hyperReadCanvas(document).elements[0], document)).toBe('Concurrent edit'); f.store.dispose(); await f.session.dispose();
  });
  it('cancels immediately, closes its port and stops a task ID delivered late exactly once', async () => {
    const f = await fixture(); let resolve!: (value: ReturnType<typeof create<typeof CompleteTextTaskPBSchema>>) => void;
    f.backend.complete = vi.fn(() => new Promise<CompleteTextTaskPB>(done => { resolve = done; }));
    const generating = f.generate(); await vi.waitFor(() => expect(resolve).toBeDefined()); f.store.stop();
    expect(f.store.getState().status).toBe('cancelled'); expect(f.close).toHaveBeenCalled(); f.finish(); expect(f.store.getState().preview).toBeNull();
    resolve(create(CompleteTextTaskPBSchema, { taskId: 'late-task' })); await generating; await vi.waitFor(() => expect(f.backend.stop).toHaveBeenCalledExactlyOnceWith('late-task')); f.store.dispose(); await f.session.dispose();
  });
  it('stops late tasks on dismissal and ignores late stream messages', async () => {
    const f = await fixture(); let resolve!: (value: ReturnType<typeof create<typeof CompleteTextTaskPBSchema>>) => void;
    f.backend.complete = vi.fn(() => new Promise<CompleteTextTaskPB>(done => { resolve = done; })); const generating = f.generate();
    await vi.waitFor(() => expect(resolve).toBeDefined()); f.store.dispose(); f.finish(); resolve(create(CompleteTextTaskPBSchema, { taskId: 'dismissed' })); await generating;
    await vi.waitFor(() => expect(f.backend.stop).toHaveBeenCalledExactlyOnceWith('dismissed')); expect(f.documentBackend.apply).not.toHaveBeenCalled(); await f.session.dispose();
  });
  it.each(['data:' + 'x'.repeat(32769), 'error:Provider unavailable', 'ai_response_limit:Too large'])('rejects streaming errors and oversized output', async value => {
    const f = await fixture(); await f.generate(); f.emit(value); expect(f.store.getState().status).toBe('error'); expect(f.store.getState().preview).toBeNull(); await expect(f.store.apply()).rejects.toThrow(); f.store.dispose(); await f.session.dispose();
  });
  it('invalidates a preview when choosing a different model or editing a prompt', async () => {
    const f = await fixture(); await f.generate(); f.finish(); await f.store.selectModel(f.model);
    expect(f.store.getState().result).toBeNull(); expect(f.backend.selectModel).toHaveBeenCalledWith('document', f.model);
    await f.generate(); f.finish(); f.store.reset(); expect(f.store.getState().status).toBe('idle'); await expect(f.store.apply()).rejects.toThrow(); f.store.dispose(); await f.session.dispose();
  });
  it('keeps an accepted draft after a failed save and refuses to insert it twice', async () => {
    const f = await fixture(); await f.generate(); f.finish();
    f.documentBackend.apply = vi.fn(async () => { throw new Error('Save failed'); }); await expect(f.store.apply()).rejects.toThrow('Save failed');
    await expect(f.store.apply()).rejects.toThrow('Generate and review'); expect(hyperReadCanvas(f.session.store.getState().document!).elements).toHaveLength(3); f.store.dispose(); await f.session.dispose();
  });
});
