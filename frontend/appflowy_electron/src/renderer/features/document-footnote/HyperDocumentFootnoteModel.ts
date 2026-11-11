import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperCanEditDocumentText, hyperChildren, hyperEditText, hyperPlainText, hyperTextTypes, type HyperDocumentChange, type HyperTextRun } from '../document/HyperDocumentModel';
import { hyperCaptureMentionSelection, hyperInsertMentionAtSelection, type HyperMentionSelection } from '../document/HyperDocumentMentions';
import { hyperDocumentFootnoteAttribute, hyperDocumentFootnoteSignature, hyperDocumentFootnoteUrl, hyperReadDocumentFootnote, type HyperDocumentFootnoteDraft, type HyperDocumentFootnoteRead, type HyperDocumentFootnoteValue } from './HyperDocumentFootnoteValue';

// Core/Yrs may serialize JSON object keys in a different order after a fresh read.
// Compare complete values, while leaving original attribute objects and bytes untouched.
const snapshot = (value: unknown) => JSON.stringify(value, (_, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const selectionSnapshot = (value: string) => { try { return snapshot(JSON.parse(value)); } catch { throw Error('changed'); } };
interface HyperFootnoteBlock { path: string; runs: HyperTextRun[]; snapshot: string; editable: boolean }
export interface HyperFootnoteEntry { blockId: string; offset: number; read: HyperDocumentFootnoteRead; signature: string; attributes: Record<string, unknown>; insert: HyperTextRun['insert'] }
export interface HyperFootnoteGroup { label: string; signature: string; entries: HyperFootnoteEntry[]; conflict: boolean }
export interface HyperFootnoteIndex { pageId: string; blocks: Map<string, HyperFootnoteBlock>; groups: Map<string, HyperFootnoteGroup>; entries: HyperFootnoteEntry[]; conflict: boolean }
export interface HyperFootnoteInsertion { kind: 'insert'; pageId: string; path: string; selection: HyperMentionSelection | null; children?: string }
export interface HyperFootnoteTarget { kind: 'existing'; pageId: string; blockId: string; offset: number; path: string; snapshot: string; group: string; label: string; signature: string; read: HyperDocumentFootnoteRead; attributes: Record<string, unknown>; insert: HyperTextRun['insert']; editable: boolean }
export type HyperFootnoteAnchor = HyperFootnoteInsertion | HyperFootnoteTarget;
const blockPart = (doc: DocumentDataPB, id: string) => { const block = doc.blocks[id]; if (!block) throw Error('changed'); return [block.id, block.parentId, block.childrenId, block.ty, block.oneOfExternalId, block.oneOfExternalType]; };
/** Only reachable page text participates. Labels are stored identities, never render-time counters. */
export function hyperDocumentFootnoteIndex(doc: DocumentDataPB): HyperFootnoteIndex {
  const blocks = new Map<string, HyperFootnoteBlock>(), groups = new Map<string, HyperFootnoteGroup>(), entries: HyperFootnoteEntry[] = [], visited = new Set<string>(), noteIds = new Map<string, string>(); let conflict = false;
  const walk = (id: string, chain: unknown[]) => {
    const block = doc.blocks[id]; if (!block || visited.has(id)) throw Error('changed'); visited.add(id);
    const path = [...chain, blockPart(doc, id)];
    if (block.ty === 'hyper_canvas') return;
    if (hyperTextTypes.has(block.ty)) {
      const runs = hyperBlockText(doc, block); blocks.set(id, { path: JSON.stringify(path), runs, snapshot: snapshot(runs), editable: block.ty !== 'code' && hyperCanEditDocumentText(doc, block) });
      let offset = 0;
      for (const run of runs) {
        const read = hyperReadDocumentFootnote(run), length = typeof run.insert === 'string' ? run.insert.length : 1;
        if (read) {
          const signature = hyperDocumentFootnoteSignature(read);
          for (let at = 0; at < (read.atomic ? length : 1); at++) {
            const entry = { blockId: id, offset: offset + at, read, signature, attributes: run.attributes ?? {}, insert: read.atomic ? ' ' : structuredClone(run.insert) }; entries.push(entry);
            if (!read.label) continue;
            let group = groups.get(read.label);
            if (!group) { group = { label: read.label, signature, entries: [], conflict: false }; groups.set(read.label, group); }
            if (group.signature !== signature) { group.conflict = true; conflict = true; }
            group.entries.push(entry);
            const raw = read.raw, noteId = read.key === 'hyper_footnote' && raw && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string' ? raw.id : null;
            if (noteId) { const key = JSON.stringify([read.label, signature]), previous = noteIds.get(noteId); if (previous && previous !== key) conflict = true; noteIds.set(noteId, key); }
          }
        }
        offset += length;
      }
    }
    for (const child of hyperChildren(doc, block)) { if (doc.blocks[child]?.parentId !== id) throw Error('changed'); walk(child, path); }
  };
  walk(doc.pageId, []); return { pageId: doc.pageId, blocks, groups, entries, conflict };
}
function groupSnapshot(index: HyperFootnoteIndex, label: string) {
  const group = index.groups.get(label); if (!group) return '';
  const blocks = new Map<string, { path: string; snapshot: string; offsets: number[] }>();
  for (const entry of group.entries) { let block = blocks.get(entry.blockId); if (!block) { const source = index.blocks.get(entry.blockId)!; block = { path: source.path, snapshot: source.snapshot, offsets: [] }; blocks.set(entry.blockId, block); } block.offsets.push(entry.offset); }
  return JSON.stringify([...blocks]);
}
function boundary(runs: HyperTextRun[], offset: number) {
  const text = hyperPlainText(runs); if (!Number.isInteger(offset) || offset < 0 || offset > text.length || offset && offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(text[offset])) throw Error('invalidPosition');
}
export function hyperCaptureFootnoteInsertion(doc: DocumentDataPB, selection: HyperMentionSelection | null, replaceSelection = false): HyperFootnoteInsertion {
  if (!selection) return { kind: 'insert', pageId: doc.pageId, path: JSON.stringify([blockPart(doc, doc.pageId)]), selection: null, children: JSON.stringify(hyperChildren(doc, doc.blocks[doc.pageId])) };
  const index = hyperDocumentFootnoteIndex(doc), block = index.blocks.get(selection.id);
  if (!block?.editable || block.snapshot !== selectionSnapshot(selection.runs)) throw Error('changed');
  boundary(block.runs, selection.selection.start); boundary(block.runs, selection.selection.end);
  return { kind: 'insert', pageId: doc.pageId, path: block.path, selection: { ...selection, runs: block.snapshot, selection: replaceSelection ? { ...selection.selection } : { start: selection.selection.end, end: selection.selection.end } } };
}
export function hyperCaptureDocumentFootnote(doc: DocumentDataPB, blockId: string, offset: number): HyperFootnoteTarget {
  const index = hyperDocumentFootnoteIndex(doc), entry = index.entries.find(entry => entry.blockId === blockId && entry.offset === offset), block = index.blocks.get(blockId);
  if (!entry || !block) throw Error('changed');
  const group = index.groups.get(entry.read.label);
  return { kind: 'existing', pageId: doc.pageId, blockId, offset, path: block.path, snapshot: block.snapshot, group: groupSnapshot(index, entry.read.label), label: entry.read.label, signature: entry.signature, read: entry.read, attributes: structuredClone(entry.attributes), insert: structuredClone(entry.insert), editable: !index.conflict && !group?.conflict && !!group && group.entries.every(item => item.read.editable && index.blocks.get(item.blockId)?.editable) };
}
export function hyperAssertFootnoteAnchor(doc: DocumentDataPB, target: HyperFootnoteAnchor): HyperFootnoteIndex {
  if (target.pageId !== doc.pageId) throw Error('changed');
  const index = hyperDocumentFootnoteIndex(doc);
  if (target.kind === 'existing') {
    const block = index.blocks.get(target.blockId), entry = index.entries.find(entry => entry.blockId === target.blockId && entry.offset === target.offset);
    if (!block || !entry || block.path !== target.path || block.snapshot !== target.snapshot || entry.signature !== target.signature || groupSnapshot(index, target.label) !== target.group) throw Error('changed');
  } else if (target.selection) {
    const block = index.blocks.get(target.selection.id);
    if (!block?.editable || block.path !== target.path || block.snapshot !== selectionSnapshot(target.selection.runs)) throw Error('changed');
  } else if (target.path !== JSON.stringify([blockPart(doc, doc.pageId)]) || target.children !== JSON.stringify(hyperChildren(doc, doc.blocks[doc.pageId]))) throw Error('changed');
  return index;
}
function nextLabel(index: HyperFootnoteIndex) { let label = 1; while (index.groups.has(String(label))) label++; return String(label); }
export function hyperBuildDocumentFootnote(index: HyperFootnoteIndex, draft: HyperDocumentFootnoteDraft, original?: HyperDocumentFootnoteValue): HyperDocumentFootnoteValue {
  if (index.conflict) throw Error('conflict');
  if (draft.kind === 'existing') {
    if (original) throw Error('unsupported'); const group = index.groups.get(draft.existingLabel), value = group?.entries[0]?.read;
    if (!group || group.conflict || !value?.supported || !value.value) throw Error('unsupported'); return structuredClone(value.value);
  }
  const label = original?.data.label ?? nextLabel(index);
  if (draft.kind === 'note') {
    if (original && original.kind !== 'note') throw Error('unsupported'); if (!draft.text.trim()) throw Error('invalidNote');
    return { kind: 'note', data: { ...(original?.kind === 'note' ? original.data : {}), version: 1, id: original?.kind === 'note' ? original.data.id : crypto.randomUUID(), label, text: draft.text } };
  }
  if (original && (original.kind !== 'citation' || original.data.reference.type !== draft.kind)) throw Error('unsupported');
  if (draft.kind === 'doc' && !draft.docId) throw Error('choosePage'); if (draft.kind === 'url' && !hyperDocumentFootnoteUrl(draft.url)) throw Error('invalidUrl');
  const reference = { ...(original?.kind === 'citation' ? original.data.reference : {}), type: draft.kind };
  Object.assign(reference, draft.kind === 'doc' ? { docId: draft.docId } : { url: draft.url });
  for (const key of ['title', 'description'] as const) if (draft[key] || Object.hasOwn(reference, key)) reference[key] = draft[key];
  return { kind: 'citation', data: { ...(original?.kind === 'citation' ? original.data : {}), label, reference } };
}
export function hyperSaveDocumentFootnote(doc: DocumentDataPB, target: HyperFootnoteAnchor, draft: HyperDocumentFootnoteDraft): HyperDocumentChange {
  const index = hyperAssertFootnoteAnchor(doc, target);
  if (target.kind === 'existing' && !target.editable) throw Error('unsupported');
  const value = hyperBuildDocumentFootnote(index, draft, target.kind === 'existing' ? target.read.value ?? undefined : undefined);
  return hyperApplyDocumentFootnoteValue(doc, target, value, draft.kind === 'existing');
}
/** A prepared value freezes the new ID/label across awaited permission checks and save uncertainty. */
export function hyperApplyDocumentFootnoteValue(doc: DocumentDataPB, target: HyperFootnoteAnchor, value: HyperDocumentFootnoteValue, reuse = false): HyperDocumentChange {
  const index = hyperAssertFootnoteAnchor(doc, target), attributes = hyperDocumentFootnoteAttribute(value);
  if (index.conflict) throw Error('conflict');
  if (target.kind === 'insert') {
    const group = index.groups.get(value.data.label), signature = hyperDocumentFootnoteSignature(hyperReadDocumentFootnote({ insert: ' ', attributes })!);
    if (reuse ? !group || group.conflict || group.signature !== signature : group !== undefined) throw Error('changed');
    if (!reuse && value.kind === 'note' && index.entries.some(entry => entry.read.value?.kind === 'note' && entry.read.value.data.id === value.data.id)) throw Error('conflict');
    const selection = target.selection ? hyperCaptureMentionSelection(doc, { id: target.selection.id, selection: target.selection.selection }) : null;
    return hyperInsertMentionAtSelection(doc, selection, [{ insert: ' ', attributes }]);
  }
  if (!target.editable || value.data.label !== target.label || value.kind !== target.read.value?.kind || value.kind === 'note' && target.read.value?.kind === 'note' && value.data.id !== target.read.value.data.id || value.kind === 'citation' && target.read.value?.kind === 'citation' && value.data.reference.type !== target.read.value.data.reference.type) throw Error('unsupported');
  const key = value.kind === 'note' ? 'hyper_footnote' : 'footnote', signature = hyperDocumentFootnoteSignature(hyperReadDocumentFootnote({ insert: ' ', attributes })!);
  if (signature === target.signature) return { document: doc, actions: [], focus: { id: target.blockId, offset: target.offset + 1 } };
  let document = doc; const actions: HyperDocumentChange['actions'] = [], touched = new Set<string>();
  for (const entry of index.groups.get(target.label)!.entries) {
    if (touched.has(entry.blockId)) continue; touched.add(entry.blockId);
    const runs = index.blocks.get(entry.blockId)!.runs.map(run => { const read = hyperReadDocumentFootnote(run); return read?.label === target.label && hyperDocumentFootnoteSignature(read) === target.signature ? { ...run, attributes: { ...run.attributes, [key]: structuredClone(value.data) } } : run; });
    const changed = hyperEditText(document, entry.blockId, runs); document = changed.document; actions.push(...changed.actions);
  }
  return { document, actions, focus: { id: target.blockId, offset: target.offset + 1 } };
}
export function hyperRemoveDocumentFootnote(doc: DocumentDataPB, target: HyperFootnoteTarget): HyperDocumentChange {
  hyperAssertFootnoteAnchor(doc, target); if (!target.editable) throw Error('unsupported');
  const selection = hyperCaptureMentionSelection(doc, { id: target.blockId, selection: { start: target.offset, end: target.offset + 1 } });
  return hyperInsertMentionAtSelection(doc, selection, []);
}
