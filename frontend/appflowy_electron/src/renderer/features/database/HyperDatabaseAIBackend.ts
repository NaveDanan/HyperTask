import { fromBinary } from '@bufbuild/protobuf';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { TranslateLanguagePB, TranslateTypeOptionPBSchema } from '@shared/protobuf/flowy-database2/translate_entities_pb';
import { FolderEventGetView, FolderEventReadCurrentWorkspace, UserEventGetUserProfile } from '@/backend/events';
import { DatabaseEventGetRowMeta } from '@/backend/events/flowy-database2';
import { unwrap } from '@/backend/dispatch';
import { acquireHyperDocument } from '../document/HyperDocumentSession';
import { hyperGetDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperDocumentPlainText } from '../document/HyperDocumentModel';
import { rowDocumentIdForRow } from '../templates/converter';
import { hyperDocumentAIBackend } from '../document-ai/HyperDocumentAIStore';
import { hyperDecodeCell } from './HyperDatabaseCells';
import type { HyperDatabaseRepository } from './HyperDatabaseRepository';
import type { HyperDatabaseAIBackend, HyperDatabaseAIContext, HyperDatabaseAISource } from './HyperDatabaseAIStore';

export const hyperDatabaseAIRowDocument = '$row-document';
const languages: Record<number, string> = {
  [TranslateLanguagePB.TraditionalChinese]: 'Traditional Chinese', [TranslateLanguagePB.English]: 'English', [TranslateLanguagePB.French]: 'French', [TranslateLanguagePB.German]: 'German',
  [TranslateLanguagePB.Hindi]: 'Hindi', [TranslateLanguagePB.Spanish]: 'Spanish', [TranslateLanguagePB.Portuguese]: 'Portuguese', [TranslateLanguagePB.StandardArabic]: 'Standard Arabic', [TranslateLanguagePB.SimplifiedChinese]: 'Simplified Chinese',
};
export function hyperDatabaseAILanguage(options: Uint8Array): string {
  try { return languages[fromBinary(TranslateTypeOptionPBSchema, options).language] ?? ''; } catch { return ''; }
}
const bytesKey = (bytes: Uint8Array) => Array.from(bytes).join(',');
const supportedSources = new Set([FieldType.RichText, FieldType.Number, FieldType.DateTime, FieldType.SingleSelect, FieldType.MultiSelect, FieldType.Checkbox, FieldType.URL, FieldType.CreatedTime, FieldType.LastEditedTime, FieldType.Checklist, FieldType.Relation, FieldType.Media, FieldType.Time]);
export function hyperDatabaseAIBackend(repository: HyperDatabaseRepository): HyperDatabaseAIBackend {
  return {
    ai: hyperDocumentAIBackend,
    async read(context: HyperDatabaseAIContext) {
      const verifyContext = async () => {
        const [workspace, user, view] = await Promise.all([
          FolderEventReadCurrentWorkspace().then(unwrap), UserEventGetUserProfile().then(unwrap), FolderEventGetView({ value: context.viewId }).then(unwrap),
        ]);
        if (workspace.id !== context.workspaceId || String(user.id) !== context.actorId || view.oneOfIsLocked.case === 'isLocked' && view.oneOfIsLocked.value) throw new Error('The workspace, account or edit permission changed.');
      };
      await verifyContext();
      const snapshot = await repository.load(context.viewId);
      const target = snapshot.fields.find(field => field.id === context.fieldId);
      const row = snapshot.database.rows.find(row => row.id === context.rowId);
      if (!row || !target || target.fieldType !== context.fieldType || ![FieldType.Summary, FieldType.Translate].includes(target.fieldType)) throw new Error('The row or AI property changed. Reopen this cell.');
      const rowMeta = unwrap(await DatabaseEventGetRowMeta({ viewId: context.viewId, rowId: context.rowId }));
      if (rowMeta.id !== context.rowId) throw new Error('The row changed. Reopen this cell.');
      const cell = await repository.cell(context.viewId, context.rowId, context.fieldId);
      const fields = snapshot.fields.filter(field => field.id !== target.id && supportedSources.has(field.fieldType));
      const sources: HyperDatabaseAISource[] = Array(fields.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, fields.length) }, async () => {
        while (next < fields.length) {
          const index = next++, field = fields[index];
          const cell = await repository.cell(context.viewId, context.rowId, field.id), value = hyperDecodeCell(field, cell);
          sources[index] = { id: field.id, name: field.name, text: value.text, stamp: JSON.stringify([field.fieldType, bytesKey(field.typeOptionData), bytesKey(cell.data)]) };
        }
      }));
      if (rowMeta.oneOfIsDocumentEmpty.case === 'isDocumentEmpty' && rowMeta.oneOfIsDocumentEmpty.value === false) {
        const documentId = rowMeta.oneOfDocumentId.case === 'documentId' && rowMeta.oneOfDocumentId.value ? rowMeta.oneOfDocumentId.value : rowDocumentIdForRow(rowMeta.id);
        const owner = hyperGetDocumentOwner();
        if (!owner || owner.workspaceId !== context.workspaceId || owner.actorId !== context.actorId) throw new Error('The workspace or account changed.');
        const lease = await acquireHyperDocument(documentId, owner);
        try {
          await lease.session.flush();
          const document = lease.session.store.getState().document;
          if (!document) throw new Error('The row document is unavailable.');
          const text = hyperDocumentPlainText(document);
          sources.push({ id: hyperDatabaseAIRowDocument, name: 'Row document', text, stamp: JSON.stringify([documentId, text]) });
        } finally { lease.release(); }
      }
      const latestRow = unwrap(await DatabaseEventGetRowMeta({ viewId: context.viewId, rowId: context.rowId }));
      if (latestRow.id !== rowMeta.id || JSON.stringify([latestRow.oneOfDocumentId, latestRow.oneOfIsDocumentEmpty]) !== JSON.stringify([rowMeta.oneOfDocumentId, rowMeta.oneOfIsDocumentEmpty])) throw new Error('The row document changed. Refresh this cell.');
      await verifyContext();
      return { context, target: { text: hyperDecodeCell(target, cell).text, stamp: JSON.stringify([target.fieldType, bytesKey(target.typeOptionData), bytesKey(cell.data)]), language: target.fieldType === FieldType.Translate ? hyperDatabaseAILanguage(target.typeOptionData) : '' }, sources };
    },
    write: (context, text) => repository.updateText(context.viewId, context.rowId, context.fieldId, text),
  };
}
