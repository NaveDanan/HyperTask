import { clone } from '@bufbuild/protobuf';
import { DocumentDataPBSchema, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperChildren, type HyperTextRun } from '../document/HyperDocumentModel';
import { hyperDocumentDateMention, type HyperDateMention } from '../document-date/HyperDocumentDateValue';
import { uuidV5 } from '../templates/converter';

export interface HyperDuplicateDateReference { id: string; blockId: string; offset: number; mention: HyperDateMention; attributes: Record<string, unknown> }
export interface HyperDuplicateDocumentSnapshot { digest: string; references: HyperDuplicateDateReference[] }
const digestNamespace = '22400a7c-cbe5-5bb6-bc09-17c2ebcd82c3';
export const hyperDuplicateReminderId = (documentId: string, blockId: string, offset: number, id: string) => uuidV5(documentId, JSON.stringify(['HyperTask:document-reminder-copy:v1', blockId, offset, id]));
export const hyperDuplicateStable = (value: unknown): string => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const compatibility = () => new Error('This page contains embedded text that cannot be copied safely. The original page was kept.');
function runs(value: unknown): HyperTextRun[] {
  if (!Array.isArray(value) || value.some(run => !run || typeof run !== 'object' || Array.isArray(run) || typeof run.insert !== 'string' || 'retain' in run || 'delete' in run || run.attributes !== undefined && (!run.attributes || typeof run.attributes !== 'object' || Array.isArray(run.attributes)))) throw compatibility();
  return value as HyperTextRun[];
}
function mapRuns(input: HyperTextRun[], blockId: string, id: (blockId: string, offset: number, old: string) => string): HyperTextRun[] {
  let offset = 0;
  return input.flatMap(run => {
    const mention = hyperDocumentDateMention(run), old = mention?.reminder_id;
    if (typeof old !== 'string' || !old) { offset += (run.insert as string).length; return [run]; }
    if ((run.insert as string).length > 10_000) throw new Error('This text contains more than 10,000 reminder atoms.');
    return Array.from(run.insert as string, () => ({ ...run, insert: '$', attributes: { ...run.attributes, mention: { ...mention, reminder_id: id(blockId, offset++, old) } } }));
  });
}
/** Every serialized text is validated: native copying reconstructs the whole document. */
export function hyperRemapDuplicateDocument(source: DocumentDataPB, documentId?: string): DocumentDataPB {
  const doc = clone(DocumentDataPBSchema, source);
  if (!doc.meta || !doc.blocks[doc.pageId]) throw new Error('The page document is incomplete.');
  const remap = (blockId: string, offset: number, old: string) => documentId ? hyperDuplicateReminderId(documentId, blockId, offset, old) : '$copied-reminder';
  const owners = new Map<string, string>();
  for (const [key, block] of Object.entries(doc.blocks)) {
    if (block.id !== key) throw new Error('The page contains inconsistent block IDs.');
    const data: unknown = JSON.parse(block.data || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The page contains invalid block data.');
    if ('delta' in data) (data as Record<string, unknown>).delta = mapRuns(runs(data.delta), block.id, remap);
    block.data = hyperDuplicateStable(data);
    const textId = block.oneOfExternalId.case === 'externalId' ? block.oneOfExternalId.value : '';
    if (textId && doc.meta.textMap[textId] !== undefined) {
      if (owners.has(textId) && runs(JSON.parse(doc.meta.textMap[textId])).some(run => hyperDocumentDateMention(run)?.reminder_id)) throw new Error('A reminder text belongs to more than one block.');
      owners.set(textId, block.id);
    }
  }
  for (const [textId, text] of Object.entries(doc.meta.textMap)) doc.meta.textMap[textId] = hyperDuplicateStable(mapRuns(runs(JSON.parse(text)), owners.get(textId) ?? `text:${textId}`, remap));
  return doc;
}
export function hyperDuplicateDateReferences(doc: DocumentDataPB): HyperDuplicateDateReference[] {
  const found: HyperDuplicateDateReference[] = [], visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) throw new Error('The page contains repeated blocks.'); visited.add(id);
    const block = doc.blocks[id]; if (!block) throw new Error('A page block is missing.');
    if (block.ty === 'hyper_canvas') return;
    let offset = 0;
    // Text-backed blocks can have upstream types not yet rendered by the desktop editor.
    const data: unknown = JSON.parse(block.data || '{}');
    if (block.oneOfExternalId.case === 'externalId' || data && typeof data === 'object' && 'delta' in data) for (const run of hyperBlockText(doc, block)) {
      const mention = hyperDocumentDateMention(run), reminderId = mention?.reminder_id;
      if (typeof reminderId === 'string' && reminderId) for (let i = 0; i < (run.insert as string).length; i++) {
        if (found.length >= 10_000) throw new Error('This page has more than 10,000 reminders.');
        found.push({ id: reminderId, blockId: id, offset: offset + i, mention, attributes: run.attributes ?? {} });
      }
      offset += typeof run.insert === 'string' ? run.insert.length : 1;
    }
    for (const child of hyperChildren(doc, block)) visit(child);
  };
  visit(doc.pageId); return found;
}
export function hyperDuplicateDocumentSnapshot(doc: DocumentDataPB): HyperDuplicateDocumentSnapshot {
  const references = hyperDuplicateDateReferences(doc);
  const normalized = hyperRemapDuplicateDocument(doc);
  return { digest: uuidV5(digestNamespace, hyperDuplicateStable(normalized)), references };
}
/** Formatting and unrelated text edits do not change the timer's binding or schedule. */
export const hyperDuplicateDateBinding = (ref: HyperDuplicateDateReference) => hyperDuplicateStable({ id: ref.id, blockId: ref.blockId, date: ref.mention.date, includeTime: ref.mention.include_time === true, option: ref.mention.reminder_option ?? null, custom: ref.attributes.hyper_reminder ?? null });
