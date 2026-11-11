import { clone, create, type MessageInitShape } from '@bufbuild/protobuf';
import {
  BlockActionPBSchema, BlockActionTypePB, BlockPBSchema, ChildrenPBSchema, DocumentDataPBSchema,
  type BlockActionPB, type BlockPB, type DocumentDataPB,
} from '@shared/protobuf/flowy-document/entities_pb';

export type HyperTextRun = { insert: string | Record<string, unknown>; attributes?: Record<string, unknown> };
type TextEdit = { retain?: number; delete?: number; insert?: HyperTextRun['insert']; attributes?: Record<string, unknown> };
export interface HyperDocumentChange { document: DocumentDataPB; actions: BlockActionPB[]; focus?: { id: string; offset: number } }
export const hyperTextTypes = new Set(['paragraph', 'heading', 'bulleted_list', 'numbered_list', 'todo_list', 'toggle_list', 'quote', 'callout', 'code']);

export class HyperDocumentTextCompatibilityError extends Error {
  constructor() {
    super('This edit would insert embedded content that the desktop core cannot save. The original content is preserved. Edit the surrounding text or use a supported page or date mention.');
    this.name = 'HyperDocumentTextCompatibilityError';
  }
}
/** Rust TextDelta accepts string inserts only and silently replaces an invalid delta
 * with an empty one. Validate what is serialized, not untouched legacy snapshots. */
function supportedTextInserts(value: unknown, fullText: boolean): void {
  if (!Array.isArray(value)) throw new HyperDocumentTextCompatibilityError();
  for (const run of value) {
    if (!run || typeof run !== 'object' || Array.isArray(run)) throw new HyperDocumentTextCompatibilityError();
    const inserted = Object.hasOwn(run, 'insert');
    if (fullText && !inserted || inserted && typeof run.insert !== 'string') throw new HyperDocumentTextCompatibilityError();
  }
}
function serializeText(value: HyperTextRun[] | TextEdit[], fullText: boolean): string {
  supportedTextInserts(value, fullText);
  return JSON.stringify(value);
}

export function hyperBlockData(block: BlockPB): Record<string, unknown> {
  const data: unknown = JSON.parse(block.data || '{}');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Invalid block data: ${block.id}`);
  return data as Record<string, unknown>;
}
export function hyperBlockText(document: DocumentDataPB, block: BlockPB): HyperTextRun[] {
  const textId = block.oneOfExternalId.case === 'externalId' ? block.oneOfExternalId.value : '';
  const raw = textId && document.meta?.textMap[textId] !== undefined
    ? JSON.parse(document.meta.textMap[textId]) : hyperBlockData(block).delta ?? [];
  if (!Array.isArray(raw) || raw.some(run => !run || !('insert' in run))) throw new Error(`Invalid text: ${block.id}`);
  return raw as HyperTextRun[];
}
export const hyperPlainText = (runs: HyperTextRun[]) => runs.map(run => typeof run.insert === 'string' ? run.insert : '\uFFFC').join('');
export const hyperTextLength = (runs: HyperTextRun[]) => hyperPlainText(runs).length;
/** A legacy inline snapshot must be promoted in full; the core cannot insert its object embeds. */
export function hyperCanEditDocumentText(doc: DocumentDataPB, block: BlockPB): boolean {
  const id = block.oneOfExternalId.case === 'externalId' ? block.oneOfExternalId.value : '';
  return !!id && doc.meta?.textMap[id] !== undefined || hyperBlockText(doc, block).every(run => typeof run.insert === 'string');
}
export const hyperChildren = (doc: DocumentDataPB, block: BlockPB) => doc.meta?.childrenMap[block.childrenId]?.children ?? [];

/** Read page text in visible tree order, excluding canvas geometry and detached blocks. */
export function hyperDocumentPlainText(doc: DocumentDataPB): string {
  const visited = new Set<string>();
  const text: string[] = [];
  const walk = (id: string) => {
    if (visited.has(id)) throw new Error('Document contains a cycle or repeated block');
    visited.add(id);
    const block = doc.blocks[id];
    if (!block) throw new Error(`Missing block: ${id}`);
    if (block.ty === 'hyper_canvas') return;
    if (hyperTextTypes.has(block.ty)) text.push(hyperPlainText(hyperBlockText(doc, block)));
    else if (block.ty === 'math_equation') {
      const formula = hyperBlockData(block).formula;
      if (typeof formula !== 'string' || hyperChildren(doc, block).length) throw new Error('This equation has an unsupported format. Its source was kept.');
      text.push(formula);
    }
    for (const child of hyperChildren(doc, block)) walk(child);
  };
  walk(doc.pageId);
  return text.join('\n');
}

export function hyperSliceText(runs: HyperTextRun[], start: number, end = hyperTextLength(runs)): HyperTextRun[] {
  let at = 0;
  return runs.flatMap(run => {
    const length = typeof run.insert === 'string' ? run.insert.length : 1;
    const from = Math.max(0, start - at), to = Math.min(length, end - at);
    at += length;
    if (from >= to) return [];
    return [{ ...run, insert: typeof run.insert === 'string' ? run.insert.slice(from, to) : run.insert }];
  });
}
export function hyperFormatText(runs: HyperTextRun[], start: number, end: number, attribute: string, value: unknown): HyperTextRun[] {
  return [...hyperSliceText(runs, 0, start), ...hyperSliceText(runs, start, end).map(run => {
    const attributes = { ...run.attributes };
    if (value === null) delete attributes[attribute]; else attributes[attribute] = value;
    return { ...run, attributes };
  }), ...hyperSliceText(runs, end)];
}

// Diff by UTF-16 code point boundaries. yrs is configured for UTF-16 to match the editor.
// Retaining the common ends preserves their CRDT identities and inline attributes.
export function hyperTextDiff(before: HyperTextRun[], after: HyperTextRun[]): TextEdit[] {
  const units = (runs: HyperTextRun[]) => runs.flatMap(run => (typeof run.insert === 'string' ? Array.from(run.insert) : [run.insert]).map(insert => ({ insert, attributes: run.attributes })));
  const a = units(before), b = units(after);
  const same = (x: HyperTextRun, y: HyperTextRun) => JSON.stringify(x.insert) === JSON.stringify(y.insert) && JSON.stringify(x.attributes ?? {}) === JSON.stringify(y.attributes ?? {});
  const length = (items: HyperTextRun[]) => items.reduce((n, run) => n + (typeof run.insert === 'string' ? run.insert.length : 1), 0);
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && same(a[prefix], b[prefix])) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && same(a[a.length - 1 - suffix], b[b.length - 1 - suffix])) suffix++;
  const result: TextEdit[] = [];
  if (prefix) result.push({ retain: length(a.slice(0, prefix)) });
  const removed = length(a.slice(prefix, a.length - suffix));
  if (removed) result.push({ delete: removed });
  for (const run of b.slice(prefix, b.length - suffix)) {
    const last = result.at(-1);
    if (typeof last?.insert === 'string' && typeof run.insert === 'string' && JSON.stringify(last.attributes ?? {}) === JSON.stringify(run.attributes ?? {})) last.insert += run.insert;
    else result.push({ ...run });
  }
  return removed || b.length - suffix > prefix ? result : [];
}

const action = (type: BlockActionTypePB, payload: MessageInitShape<typeof BlockActionPBSchema>['payload']) => create(BlockActionPBSchema, { action: type, payload });
const copy = (doc: DocumentDataPB): HyperDocumentChange => ({ document: clone(DocumentDataPBSchema, doc), actions: [] });
const requiredBlock = (doc: DocumentDataPB, id: string) => {
  const block = doc.blocks[id];
  if (!block) throw new Error(`Missing block: ${id}`);
  return block;
};

function setText(change: HyperDocumentChange, id: string, runs: HyperTextRun[]) {
  const doc = change.document, block = requiredBlock(doc, id), before = hyperBlockText(doc, block);
  const diff = hyperTextDiff(before, runs);
  if (!diff.length) return;
  if (!doc.meta) throw new Error('Document has no metadata');
  let textId = block.oneOfExternalId.case === 'externalId' ? block.oneOfExternalId.value : '';
  if (!textId) {
    const serialized = serializeText(runs, true);
    textId = crypto.randomUUID();
    block.oneOfExternalId = { case: 'externalId', value: textId };
    block.oneOfExternalType = { case: 'externalType', value: 'text' };
    const data = hyperBlockData(block);
    delete data.delta;
    block.data = JSON.stringify(data);
    change.actions.push(action(BlockActionTypePB.InsertText, { oneOfTextId: { case: 'textId', value: textId }, oneOfDelta: { case: 'delta', value: serialized } }));
    change.actions.push(action(BlockActionTypePB.Update, { oneOfBlock: { case: 'block', value: block } }));
  } else change.actions.push(action(BlockActionTypePB.ApplyTextDelta, { oneOfTextId: { case: 'textId', value: textId }, oneOfDelta: { case: 'delta', value: serializeText(diff, false) } }));
  doc.meta.textMap[textId] = JSON.stringify(runs);
}
export function hyperEditText(doc: DocumentDataPB, id: string, runs: HyperTextRun[]) {
  const change = copy(doc);
  setText(change, id, runs);
  return change;
}
export function hyperUpdateBlock(doc: DocumentDataPB, id: string, data: Record<string, unknown>, type?: string) {
  const change = copy(doc), block = requiredBlock(change.document, id);
  block.data = JSON.stringify({ ...hyperBlockData(block), ...data });
  if (type && type !== block.ty) {
    if (id === doc.pageId) throw new Error('Cannot change the document root type');
    const original = requiredBlock(doc, id);
    if (original.oneOfExternalId.case === 'externalId' || hyperTextTypes.has(original.ty)) supportedTextInserts(hyperBlockText(doc, original), true);
    const validateRestore = (node: BlockPB, seen = new Set<string>()) => {
      if (seen.has(node.id)) throw new Error('The block contains a cycle or repeated child.');
      seen.add(node.id);
      const external = node.oneOfExternalId.case === 'externalId' ? node.oneOfExternalId.value : '';
      if (external || hyperTextTypes.has(node.ty) || node.id === id && hyperTextTypes.has(type)) supportedTextInserts(hyperBlockText(change.document, node), true);
      for (const childId of hyperChildren(change.document, node)) validateRestore(requiredBlock(change.document, childId), seen);
    };
    // Validate descendants before building the delete/reinsert operation. No partial
    // conversion can be returned when a later descendant needs an unsupported insert.
    validateRestore(block);
    block.ty = type;
    // Upstream Update changes only data and external text references. Type conversion uses
    // delete + insert, restoring the complete subtree with its existing ids and text.
    // Keeping the ids preserves links and reminders targeting these blocks.
    change.actions.push(action(BlockActionTypePB.Delete, { oneOfBlock: { case: 'block', value: doc.blocks[id] } }));
    const restore = (node: BlockPB, previousId: string) => {
      const textId = node.oneOfExternalId.case === 'externalId' ? node.oneOfExternalId.value : '';
      if (textId && doc.meta?.textMap[textId] !== undefined) change.actions.push(action(BlockActionTypePB.InsertText, { oneOfTextId: { case: 'textId', value: textId }, oneOfDelta: { case: 'delta', value: doc.meta.textMap[textId] } }));
      change.actions.push(action(BlockActionTypePB.Insert, { oneOfBlock: { case: 'block', value: node }, oneOfParentId: { case: 'parentId', value: node.parentId }, oneOfPrevId: { case: 'prevId', value: previousId } }));
      let previous = '';
      for (const childId of hyperChildren(change.document, node)) { restore(requiredBlock(change.document, childId), previous); previous = childId; }
    };
    const siblings = hyperChildren(doc, requiredBlock(doc, block.parentId));
    restore(block, siblings[siblings.indexOf(id) - 1] ?? '');
  } else change.actions.push(action(BlockActionTypePB.Update, { oneOfBlock: { case: 'block', value: block } }));
  return change;
}
function insert(change: HyperDocumentChange, parentId: string, previousId: string, type: string, runs: HyperTextRun[] = [], data: Record<string, unknown> = {}) {
  const doc = change.document, parent = requiredBlock(doc, parentId);
  if (!doc.meta) throw new Error('Document has no metadata');
  const serialized = hyperTextTypes.has(type) ? serializeText(runs, true) : undefined;
  const id = crypto.randomUUID(), textId = crypto.randomUUID();
  const block = create(BlockPBSchema, { id, ty: type, data: JSON.stringify(data), parentId, childrenId: crypto.randomUUID(),
    ...(hyperTextTypes.has(type) ? { oneOfExternalId: { case: 'externalId', value: textId }, oneOfExternalType: { case: 'externalType', value: 'text' } } : {}) });
  const siblings = hyperChildren(doc, parent);
  const index = previousId ? siblings.indexOf(previousId) + 1 : 0;
  if (previousId && index === 0) throw new Error('Previous block is not a sibling');
  doc.meta.childrenMap[parent.childrenId] = create(ChildrenPBSchema, { children: [...siblings.slice(0, index), id, ...siblings.slice(index)] });
  doc.meta.childrenMap[block.childrenId] = create(ChildrenPBSchema);
  doc.blocks[id] = block;
  if (hyperTextTypes.has(type)) {
    doc.meta.textMap[textId] = serialized!;
    change.actions.push(action(BlockActionTypePB.InsertText, { oneOfTextId: { case: 'textId', value: textId }, oneOfDelta: { case: 'delta', value: serialized! } }));
  }
  change.actions.push(action(BlockActionTypePB.Insert, { oneOfBlock: { case: 'block', value: block }, oneOfParentId: { case: 'parentId', value: parentId }, oneOfPrevId: { case: 'prevId', value: previousId } }));
  change.focus = { id, offset: 0 };
  return id;
}
export function hyperInsertBlock(doc: DocumentDataPB, parentId: string, previousId: string, type = 'paragraph', data: Record<string, unknown> = {}) {
  const change = copy(doc);
  insert(change, parentId, previousId, type, [], data);
  return change;
}
export function hyperSplitBlock(doc: DocumentDataPB, id: string, start: number, end = start) {
  const change = copy(doc), block = requiredBlock(change.document, id), runs = hyperBlockText(doc, block);
  setText(change, id, hyperSliceText(runs, 0, start));
  const type = ['bulleted_list', 'numbered_list', 'todo_list', 'toggle_list'].includes(block.ty) ? block.ty : 'paragraph';
  insert(change, block.parentId, id, type, hyperSliceText(runs, end), type === 'todo_list' ? { checked: false } : {});
  return change;
}
export function hyperDeleteBlock(doc: DocumentDataPB, id: string) {
  if (id === doc.pageId) throw new Error('Cannot delete the document root');
  const change = copy(doc), block = requiredBlock(change.document, id), parent = requiredBlock(change.document, block.parentId);
  const visit = (node: BlockPB) => {
    for (const child of hyperChildren(change.document, node)) visit(requiredBlock(change.document, child));
    change.actions.push(action(BlockActionTypePB.Delete, { oneOfBlock: { case: 'block', value: node }, oneOfParentId: { case: 'parentId', value: node.parentId } }));
    delete change.document.blocks[node.id];
    delete change.document.meta!.childrenMap[node.childrenId];
    if (node.oneOfExternalId.case === 'externalId') delete change.document.meta!.textMap[node.oneOfExternalId.value];
  };
  visit(block);
  change.document.meta!.childrenMap[parent.childrenId] = create(ChildrenPBSchema, { children: hyperChildren(doc, parent).filter(child => child !== id) });
  return change;
}

export function hyperMoveBlock(doc: DocumentDataPB, id: string, parentId: string, previousId: string): HyperDocumentChange {
  if (id === doc.pageId || id === previousId) throw new Error('Invalid block move');
  const change = copy(doc), block = requiredBlock(change.document, id), parent = requiredBlock(change.document, parentId);
  let ancestor: BlockPB | undefined = parent;
  const visited = new Set<string>();
  while (ancestor) {
    if (ancestor.id === id || visited.has(ancestor.id)) throw new Error('A block cannot move into its own subtree');
    visited.add(ancestor.id); ancestor = change.document.blocks[ancestor.parentId];
  }
  const oldParent = requiredBlock(change.document, block.parentId);
  const target = hyperChildren(change.document, parent).filter(child => child !== id);
  const at = previousId ? target.indexOf(previousId) + 1 : 0;
  if (previousId && at === 0) throw new Error('Previous block is not a sibling');
  change.document.meta!.childrenMap[oldParent.childrenId] = create(ChildrenPBSchema, { children: hyperChildren(change.document, oldParent).filter(child => child !== id) });
  change.document.meta!.childrenMap[parent.childrenId] = create(ChildrenPBSchema, { children: [...target.slice(0, at), id, ...target.slice(at)] });
  block.parentId = parentId;
  change.actions.push(action(BlockActionTypePB.Move, { oneOfBlock: { case: 'block', value: block }, oneOfParentId: { case: 'parentId', value: parentId }, oneOfPrevId: { case: 'prevId', value: previousId } }));
  change.focus = { id, offset: 0 };
  return change;
}

export function hyperMergeWithPrevious(doc: DocumentDataPB, id: string): HyperDocumentChange {
  const block = requiredBlock(doc, id), parent = requiredBlock(doc, block.parentId);
  const siblings = hyperChildren(doc, parent), previousId = siblings[siblings.indexOf(id) - 1];
  if (!previousId || !hyperTextTypes.has(doc.blocks[previousId].ty) || !hyperTextTypes.has(block.ty)) return copy(doc);
  const previousText = hyperBlockText(doc, doc.blocks[previousId]);
  let change = hyperEditText(doc, previousId, [...previousText, ...hyperBlockText(doc, block)]);
  let lastChild = hyperChildren(doc, doc.blocks[previousId]).at(-1) ?? '';
  for (const child of hyperChildren(doc, block)) {
    const moved = hyperMoveBlock(change.document, child, previousId, lastChild);
    change = { document: moved.document, actions: [...change.actions, ...moved.actions] }; lastChild = child;
  }
  const removed = hyperDeleteBlock(change.document, id);
  return { document: removed.document, actions: [...change.actions, ...removed.actions], focus: { id: previousId, offset: hyperTextLength(previousText) } };
}

export function hyperMarkdownShortcut(doc: DocumentDataPB, id: string): HyperDocumentChange | null {
  const block = requiredBlock(doc, id);
  if (block.ty !== 'paragraph') return null;
  const text = hyperPlainText(hyperBlockText(doc, block));
  const heading = /^(#{1,6}) $/.exec(text);
  const kind = heading ? 'heading' : ({ '- ': 'bulleted_list', '* ': 'bulleted_list', '1. ': 'numbered_list', '[] ': 'todo_list', '[ ] ': 'todo_list', '[x] ': 'todo_list', '> ': 'quote', '``` ': 'code' } as Record<string, string>)[text];
  if (!kind) return null;
  const cleared = hyperEditText(doc, id, []);
  const converted = hyperUpdateBlock(cleared.document, id, heading ? { level: heading[1].length } : kind === 'todo_list' ? { checked: text === '[x] ' } : {}, kind);
  return { document: converted.document, actions: [...cleared.actions, ...converted.actions], focus: { id, offset: 0 } };
}
