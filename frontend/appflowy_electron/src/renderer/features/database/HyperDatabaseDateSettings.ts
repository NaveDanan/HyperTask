import { toBinary } from '@bufbuild/protobuf';
import { FieldType, type FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { DateTypeOptionPBSchema, type DateTypeOptionPB } from '@shared/protobuf/flowy-database2/date_entities_pb';
import { DatabaseEventGetDatabase, DatabaseEventGetFields, DatabaseEventUpdateFieldTypeOption } from '@/backend/events/flowy-database2';
import { unwrap } from '@/backend/dispatch';
import { hyperDatabaseDraftFieldKey, hyperDatabaseDrafts, type HyperDatabaseDraftOwner } from './HyperDatabaseDraft';
import { hyperReadDatabaseWriteView } from './HyperDatabaseDraftBackend';
import { HyperDatabaseDateError, hyperDatabaseDateCloneOptions, hyperDatabaseDateOptions } from './HyperDatabaseDate';

export async function hyperUpdateDatabaseDateSettings(viewId: string, databaseId: string, source: FieldPB, options: DateTypeOptionPB, owner: HyperDatabaseDraftOwner, current: () => boolean) {
  const check = () => {
    if (!owner.isCurrent() || !current()) throw new HyperDatabaseDateError('changed');
    if (hyperDatabaseDrafts.pending(owner, databaseId).some(record => record.target.fieldId === source.id)) throw new HyperDatabaseDateError('pending');
  };
  check();
  const [database, fields] = await Promise.all([DatabaseEventGetDatabase({ value: viewId }), DatabaseEventGetFields({ viewId }), hyperReadDatabaseWriteView(viewId, owner)]);
  check();
  const field = unwrap(fields).items.find(field => field.id === source.id);
  if (unwrap(database).id !== databaseId || !field || field.fieldType !== FieldType.DateTime || hyperDatabaseDraftFieldKey(field) !== hyperDatabaseDraftFieldKey(source)) throw new HyperDatabaseDateError('changed');
  const next = hyperDatabaseDateCloneOptions(hyperDatabaseDateOptions(field.typeOptionData), { dateFormat: options.dateFormat, timeFormat: options.timeFormat, timezoneId: options.timezoneId });
  check();
  unwrap(await DatabaseEventUpdateFieldTypeOption({ viewId, fieldId: field.id, typeOptionData: toBinary(DateTypeOptionPBSchema, next) }));
}
