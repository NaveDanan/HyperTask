import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { hyperCollectionPages, hyperDefaultCollection, hyperIsCollectionView, hyperMergeCollection, hyperMergePageProperty, hyperPageProperties, hyperReadCollection, hyperValidateCollection, hyperValidateProperty, type HyperCollectionRule } from './HyperCollectionModel';

const page = (id = 'page', extra = '{}') => create(ViewPBSchema, { id, name: id, oneOfExtra: { case: 'extra', value: extra } });
describe('Hyper collection properties and rules', () => {
  it('preserves covers, journals, unknown fields and unsupported properties during property updates', () => {
    const original = page('one', '{"cover":{"color":"red"},"hyperOrganization":{"journalDate":"2026-11-10","future":42,"properties":{"unsupported":{"type":"future","value":17},"priority":{"name":"Priority","type":"number","value":1,"future":"kept"}}}}');
    const next = page('one', hyperMergePageProperty(original, 'priority', { name: 'Priority', type: 'number', value: 3 }));
    expect(JSON.parse(next.oneOfExtra.case === 'extra' ? next.oneOfExtra.value : '{}')).toEqual({ cover: { color: 'red' }, hyperOrganization: { journalDate: '2026-11-10', future: 42, properties: { unsupported: { type: 'future', value: 17 }, priority: { name: 'Priority', type: 'number', value: 3, future: 'kept' } } } });
    expect(hyperPageProperties(next)).toMatchObject({ properties: { priority: { value: 3 } }, unsupported: ['unsupported'] });
    expect(() => hyperMergePageProperty(next, 'unsupported', { name: 'New', type: 'text', value: 'overwrite' })).toThrow();
    expect(hyperPageProperties(page('one', hyperMergePageProperty(next, 'priority', null))).properties).not.toHaveProperty('priority');
  });
  it('rejects malformed metadata, invalid property keys and values without coercion', () => {
    for (const extra of ['[]', '{bad', '{"hyperOrganization":[]}', '{"hyperOrganization":{"properties":[]}}']) expect(() => hyperMergePageProperty(page('bad', extra), 'key', { name: 'Name', type: 'text', value: 'x' })).toThrow();
    expect(() => hyperMergePageProperty(page(), '__proto__', { name: 'Name', type: 'text', value: 'x' })).toThrow('key');
    for (const property of [{ name: 'N', type: 'number', value: '4' }, { name: 'N', type: 'number', value: Infinity }, { name: 'D', type: 'date', value: '2026-02-30' }, { name: 'C', type: 'checkbox', value: 'false' }]) expect(() => hyperValidateProperty(property)).toThrow('type');
  });
  it('supports typed comparison rules, all/any matching, query/tag constraints and stable sorting', () => {
    let first = page('Alpha', '{"hyperOrganization":{"tags":["Work"]}}');
    first = page('Alpha', hyperMergePageProperty(first, 'priority', { name: 'Priority', type: 'number', value: 3 }));
    first = page('Alpha', hyperMergePageProperty(first, 'due_date', { name: 'Due', type: 'date', value: '2026-11-10' }));
    const second = page('Beta', hyperMergePageProperty(page('Beta'), 'priority', { name: 'Priority', type: 'number', value: 1 }));
    const rules: HyperCollectionRule[] = [{ property: 'priority', type: 'number', operator: 'gt', value: 2 }, { property: 'due_date', type: 'date', operator: 'before', value: '2026-12-01' }];
    expect(hyperCollectionPages([second, first], { ...hyperDefaultCollection(), rules }).map(page => page.name)).toEqual(['Alpha']);
    expect(hyperCollectionPages([second, first], { ...hyperDefaultCollection(), match: 'any', rules: [...rules, { property: 'due_date', type: 'date', operator: 'missing' }] })).toHaveLength(2);
    expect(hyperCollectionPages([second, first], { ...hyperDefaultCollection(), query: 'alpha', tag: 'work', sort: 'name' }).map(page => page.id)).toEqual(['Alpha']);
    expect(hyperCollectionPages([second, first], { ...hyperDefaultCollection(), rules: [{ property: 'priority', type: 'text', operator: 'exists' }] })).toEqual([]);
  });
  it('treats false and zero as real values and handles text rules case-insensitively', () => {
    let first = page('a', hyperMergePageProperty(page('a'), 'done', { name: 'Done', type: 'checkbox', value: false }));
    first = page('a', hyperMergePageProperty(first, 'score', { name: 'Score', type: 'number', value: 0 }));
    first = page('a', hyperMergePageProperty(first, 'status', { name: 'Status', type: 'text', value: 'In Progress' }));
    for (const rule of [{ property: 'done', type: 'checkbox', operator: 'equals', value: false }, { property: 'score', type: 'number', operator: 'equals', value: 0 }, { property: 'status', type: 'text', operator: 'contains', value: 'PROGRESS' }] as HyperCollectionRule[]) expect(hyperCollectionPages([first], { ...hyperDefaultCollection(), rules: [rule] })).toHaveLength(1);
  });
  it('preserves unsupported collection pages while reporting bad configurations and excludes collection pages from matches', () => {
    const collection = page('saved', hyperMergeCollection(page(), { ...hyperDefaultCollection(), tag: 'Work' }));
    expect(hyperIsCollectionView(collection)).toBe(true); expect(hyperReadCollection(collection)?.tag).toBe('Work');
    expect(hyperCollectionPages([collection, page()], hyperDefaultCollection())).toHaveLength(1);
    const future = page('future', '{"hyperOrganization":{"collection":{"version":2}}}');
    expect(hyperIsCollectionView(future)).toBe(true); expect(() => hyperReadCollection(future)).toThrow('not supported');
    expect(() => hyperMergeCollection(future, hyperDefaultCollection())).toThrow('not supported');
    expect(() => hyperValidateCollection({ ...hyperDefaultCollection(), rules: [{ property: 'priority', type: 'number', operator: 'contains', value: 3 }] })).toThrow('rule');
  });
});
