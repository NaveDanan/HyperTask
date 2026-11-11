import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, type HyperDocumentChange } from '../document/HyperDocumentModel';
import { hyperCaptureMentionSelection, hyperInsertMentionAtSelection, type HyperMentionSelection } from '../document/HyperDocumentMentions';
import { hyperDocumentDateMention, type HyperDateMention, type HyperDateTarget } from './HyperDocumentDateValue';
export * from './HyperDocumentDateValue';

export function hyperCaptureDocumentDate(doc: DocumentDataPB, blockId: string, ordinal: number): HyperDateTarget {
  const block = doc.blocks[blockId]; if (!block || !Number.isInteger(ordinal) || ordinal < 0) throw new Error('The date mention is no longer available.');
  let offset = 0, count = 0;
  for (const run of hyperBlockText(doc, block)) {
    const mention = hyperDocumentDateMention(run);
    if (mention) for (let i = 0; i < (run.insert as string).length; i++) {
      if (count++ === ordinal) return { selection: hyperCaptureMentionSelection(doc, { id: blockId, selection: { start: offset + i, end: offset + i + 1 } })!, mention: { ...mention }, attributes: { ...run.attributes } };
    }
    offset += typeof run.insert === 'string' ? run.insert.length : 1;
  }
  throw new Error('The date mention is no longer available.');
}
export function hyperApplyDocumentDate(doc: DocumentDataPB, target: HyperMentionSelection | null, mention: HyperDateMention, attributes: Record<string, unknown> = {}): HyperDocumentChange {
  return hyperInsertMentionAtSelection(doc, target, [{ insert: '$', attributes: { ...attributes, mention } }]);
}
