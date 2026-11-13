import { DatabaseEventGetDatabase, DatabaseEventGetRowMeta } from '@/backend/events/flowy-database2';
import { FolderEventListTrashItems } from '@/backend/events/flowy-folder';
import { unwrap } from '@/backend/dispatch';
import { hyperGetDocumentOwner } from '../document/HyperDocumentOwner';
import { flushHyperDocumentForCopy } from '../document/HyperDocumentSession';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { hyperReadDatabaseWriteView } from './HyperDatabaseDraftBackend';
import { hyperDatabaseDrafts } from './HyperDatabaseDraft';
import { HyperDatabaseRowDuplicateService, type HyperDatabaseRowDuplicateBackend } from './HyperDatabaseRowDuplicateService';
import { HyperDatabaseRepository } from './HyperDatabaseRepository';
const repository = new HyperDatabaseRepository();
export const hyperDatabaseRowDuplicateBackend: HyperDatabaseRowDuplicateBackend = {
  owner: hyperGetDocumentOwner, capture: hyperCaptureDuplicateOwner,
  async writable(viewId, owner, check) {
    const view = await check(() => hyperReadDatabaseWriteView(viewId, owner)), trash = unwrap(await check(() => FolderEventListTrashItems()));
    if (trash.items.some(item => item.id === viewId)) throw new Error('This database is in Trash. Restore it before copying rows.');
    return view;
  },
  database: async value => unwrap(await DatabaseEventGetDatabase({ value })),
  row: async (viewId, rowId) => unwrap(await DatabaseEventGetRowMeta({ viewId, rowId })),
  flush: flushHyperDocumentForCopy,
  pending: (owner, databaseId) => hyperDatabaseDrafts.pending(owner, databaseId).length > 0,
  duplicate: request => repository.duplicateRow(request),
};
export const hyperDatabaseRowDuplicates = new HyperDatabaseRowDuplicateService(hyperDatabaseRowDuplicateBackend);
