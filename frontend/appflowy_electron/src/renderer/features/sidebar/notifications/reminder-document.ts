// Reading reminder targets out of a document (DocumentDataPB → editor Node lookups used by
// ReminderBloc.checkReminderAvailable and NotificationReminderBloc).
import type { BlockPB, DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';

export interface DeltaOp {
  insert: unknown;
  attributes?: Record<string, unknown>;
}

/** The block (editor node) with the given id. */
export function findBlock(doc: DocumentDataPB, blockId: string): BlockPB | undefined {
  return doc.blocks[blockId];
}

/** The node's delta: text_map[external_id], or `data.delta` for older documents. */
export function blockDelta(doc: DocumentDataPB, block: BlockPB): DeltaOp[] | null {
  const externalId = block.oneOfExternalId.case === 'externalId' ? block.oneOfExternalId.value : '';
  const text = externalId ? doc.meta?.textMap[externalId] : undefined;
  try {
    if (text) {
      const ops = JSON.parse(text);
      if (Array.isArray(ops)) return ops as DeltaOp[];
    }
    const data = block.data ? JSON.parse(block.data) : null;
    if (data && Array.isArray(data.delta)) return data.delta as DeltaOp[];
  } catch {
    // invalid JSON: no delta
  }
  return null;
}

/** node.path.first: the index of the block's top-level ancestor among the page's children. */
export function topLevelIndex(doc: DocumentDataPB, blockId: string): number | null {
  const page = doc.blocks[doc.pageId];
  if (!page) return null;
  const topLevel = doc.meta?.childrenMap[page.childrenId]?.children ?? [];
  let current: BlockPB | undefined = doc.blocks[blockId];
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.parentId === page.id) {
      const index = topLevel.indexOf(current.id);
      return index >= 0 ? index : null;
    }
    current = doc.blocks[current.parentId];
  }
  return null;
}

/** Whether a text insert of the node mentions one of the given reminders. */
export function deltaMentionsReminder(ops: DeltaOp[], reminderIds: Set<string>): boolean {
  return ops.some((op) => {
    if (typeof op.insert !== 'string') return false;
    const mention = op.attributes?.mention as Record<string, unknown> | undefined;
    const id = mention?.reminder_id;
    return typeof id === 'string' && reminderIds.has(id);
  });
}

/** Plain text of a delta; mentions are rendered through `mention`. */
export function deltaPlainText(ops: DeltaOp[], mention: (attributes: Record<string, unknown>) => string): string {
  return ops
    .map((op) => {
      if (typeof op.insert !== 'string') return '';
      const m = op.attributes?.mention as Record<string, unknown> | undefined;
      return m ? mention(m) : op.insert;
    })
    .join('');
}
