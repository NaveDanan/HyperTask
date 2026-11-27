import { FieldType, type FieldPB } from './protobuf/hyper-database2/field_entities_pb';

/** Field.icon is database-wide CRDT metadata, copied by the core when fields/databases are duplicated. */
export const HyperPeopleFieldIcon = 'hyper:people:v1';
export function hyperIsPeopleField(field: Pick<FieldPB, 'fieldType' | 'icon'>): boolean {
  return field.fieldType === FieldType.RichText && field.icon === HyperPeopleFieldIcon;
}
