import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { hyperFilterOrganizationPages, hyperIsJournalDate, type HyperOrganizationFilter } from './HyperOrganizationModel';

export type HyperPropertyType = 'text' | 'number' | 'date' | 'checkbox';
export interface HyperPageProperty { name: string; type: HyperPropertyType; value: string | number | boolean }
export type HyperPropertyOperator = 'exists' | 'missing' | 'equals' | 'contains' | 'before' | 'after' | 'gt' | 'lt';
export interface HyperCollectionRule { property: string; type: HyperPropertyType; operator: HyperPropertyOperator; value?: string | number | boolean }
export interface HyperCollectionConfig {
  version: 1; query: string; tag: string; match: 'all' | 'any'; rules: HyperCollectionRule[];
  sort: HyperOrganizationFilter['sort'];
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const hyperPropertyTypes: HyperPropertyType[] = ['text', 'number', 'date', 'checkbox'];
export const hyperPropertyOperators = (type: HyperPropertyType): HyperPropertyOperator[] => ['exists', 'missing', 'equals', ...(type === 'text' ? ['contains' as const] : type === 'number' ? ['gt' as const, 'lt' as const] : type === 'date' ? ['before' as const, 'after' as const] : [])];
export const hyperPropertyKey = (value: string) => /^[a-z][a-z0-9_.-]{0,79}$/.test(value);
export function hyperOrganizationRaw(view: Pick<ViewPB, 'oneOfExtra'>): Record<string, unknown> {
  const raw: unknown = view.oneOfExtra.case === 'extra' && view.oneOfExtra.value ? JSON.parse(view.oneOfExtra.value) : {};
  if (!record(raw)) throw new Error('Page metadata is not an object. It has not been changed.');
  if (raw.hyperOrganization !== undefined && !record(raw.hyperOrganization)) throw new Error('Organization metadata is invalid. It has not been changed.');
  return record(raw.hyperOrganization) ? raw.hyperOrganization : {};
}
export function hyperValidateProperty(input: unknown): HyperPageProperty {
  if (!record(input) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 || !hyperPropertyTypes.includes(input.type as HyperPropertyType)) throw new Error('Choose a property name and supported type.');
  const { value, type } = input;
  if ((type === 'text' && (typeof value !== 'string' || value.length > 10000)) || (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) || (type === 'checkbox' && typeof value !== 'boolean') || (type === 'date' && (typeof value !== 'string' || !hyperIsJournalDate(value)))) throw new Error('The property value does not match its type.');
  return { name: input.name.trim(), type: type as HyperPropertyType, value: value as HyperPageProperty['value'] };
}
export function hyperPageProperties(view: Pick<ViewPB, 'oneOfExtra'>): { properties: Record<string, HyperPageProperty>; unsupported: string[] } {
  const properties: Record<string, HyperPageProperty> = Object.create(null), unsupported: string[] = [];
  const raw = hyperOrganizationRaw(view).properties;
  if (raw === undefined) return { properties, unsupported };
  if (!record(raw)) throw new Error('Page properties are invalid. They have not been changed.');
  for (const [key, value] of Object.entries(raw)) {
    try { if (!hyperPropertyKey(key)) throw new Error('Invalid key'); properties[key] = hyperValidateProperty(value); }
    catch { unsupported.push(key); }
  }
  return { properties, unsupported };
}
export function hyperMergePageProperty(view: Pick<ViewPB, 'oneOfExtra'>, key: string, property: HyperPageProperty | null): string {
  if (!hyperPropertyKey(key)) throw new Error('Use a property key starting with a lowercase letter, followed by letters, numbers, dots, dashes or underscores.');
  const extra: unknown = view.oneOfExtra.case === 'extra' && view.oneOfExtra.value ? JSON.parse(view.oneOfExtra.value) : {};
  const organization = hyperOrganizationRaw(view), existing = organization.properties;
  if (existing !== undefined && !record(existing)) throw new Error('Page properties are invalid. They have not been changed.');
  if (record(existing) && Object.hasOwn(existing, key)) hyperValidateProperty(existing[key]);
  const properties: Record<string, unknown> = { ...existing as Record<string, unknown> | undefined };
  if (property === null) delete properties[key];
  else properties[key] = { ...(record(existing) && record(existing[key]) ? existing[key] : {}), ...hyperValidateProperty(property) };
  return JSON.stringify({ ...extra as Record<string, unknown>, hyperOrganization: { ...organization, properties } });
}
export const hyperDefaultCollection = (): HyperCollectionConfig => ({ version: 1, query: '', tag: '', match: 'all', rules: [], sort: 'edited' });
export function hyperValidateCollection(input: unknown): HyperCollectionConfig {
  if (!record(input) || input.version !== 1 || typeof input.query !== 'string' || typeof input.tag !== 'string' || !['all', 'any'].includes(String(input.match)) || !['edited', 'name', 'created'].includes(String(input.sort)) || !Array.isArray(input.rules) || input.rules.length > 100) throw new Error('This collection configuration is not supported. It has not been changed.');
  const rules = input.rules.map((rule: unknown): HyperCollectionRule => {
    if (!record(rule) || typeof rule.property !== 'string' || !hyperPropertyKey(rule.property) || !hyperPropertyTypes.includes(rule.type as HyperPropertyType) || !hyperPropertyOperators(rule.type as HyperPropertyType).includes(rule.operator as HyperPropertyOperator)) throw new Error('Choose a valid property rule.');
    if (rule.operator !== 'exists' && rule.operator !== 'missing') hyperValidateProperty({ name: rule.property, type: rule.type, value: rule.value });
    return { property: rule.property, type: rule.type as HyperPropertyType, operator: rule.operator as HyperPropertyOperator, ...(rule.operator !== 'exists' && rule.operator !== 'missing' ? { value: rule.value as HyperPageProperty['value'] } : {}) };
  });
  return { version: 1, query: input.query, tag: input.tag, match: input.match as 'all' | 'any', sort: input.sort as HyperCollectionConfig['sort'], rules };
}
export function hyperReadCollection(view: Pick<ViewPB, 'oneOfExtra'>): HyperCollectionConfig | null {
  const raw = hyperOrganizationRaw(view).collection;
  return raw === undefined ? null : hyperValidateCollection(raw);
}
export function hyperIsCollectionView(view: Pick<ViewPB, 'oneOfExtra'>): boolean {
  try { return Object.hasOwn(hyperOrganizationRaw(view), 'collection'); } catch { return false; }
}
export function hyperMergeCollection(view: Pick<ViewPB, 'oneOfExtra'>, config: HyperCollectionConfig): string {
  const raw: unknown = view.oneOfExtra.case === 'extra' && view.oneOfExtra.value ? JSON.parse(view.oneOfExtra.value) : {};
  const organization = hyperOrganizationRaw(view);
  if (organization.collection !== undefined) hyperValidateCollection(organization.collection);
  return JSON.stringify({ ...raw as Record<string, unknown>, hyperOrganization: { ...organization, collection: { ...organization.collection as Record<string, unknown> | undefined, ...hyperValidateCollection(config) } } });
}
function matches(view: ViewPB, rule: HyperCollectionRule): boolean {
  let property: HyperPageProperty | undefined;
  try { property = hyperPageProperties(view).properties[rule.property]; } catch { return false; }
  const exists = property?.type === rule.type;
  if (rule.operator === 'missing') return !exists;
  if (rule.operator === 'exists') return exists;
  if (!exists || !property) return false;
  const value = property.value, expected = rule.value;
  if (rule.operator === 'equals') return typeof value === 'string' && typeof expected === 'string' ? value.toLocaleLowerCase() === expected.toLocaleLowerCase() : value === expected;
  if (rule.operator === 'contains') return typeof value === 'string' && typeof expected === 'string' && value.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
  if (typeof value === 'number' && typeof expected === 'number') return rule.operator === 'gt' ? value > expected : value < expected;
  if (typeof value === 'string' && typeof expected === 'string') return rule.operator === 'after' ? value > expected : value < expected;
  return false;
}
export function hyperCollectionPages(views: ViewPB[], config: HyperCollectionConfig, collectionId?: string): ViewPB[] {
  const valid = hyperValidateCollection(config);
  return hyperFilterOrganizationPages(views, { query: valid.query, tag: valid.tag || null, journalsOnly: false, sort: valid.sort }).filter(view => view.id !== collectionId && !hyperIsCollectionView(view) && (!valid.rules.length || (valid.match === 'all' ? valid.rules.every(rule => matches(view, rule)) : valid.rules.some(rule => matches(view, rule)))));
}
