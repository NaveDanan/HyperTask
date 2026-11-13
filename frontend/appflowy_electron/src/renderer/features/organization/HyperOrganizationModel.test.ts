import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { hyperFilterOrganizationPages, hyperIsJournalDate, hyperLocalJournalDate, hyperMergeOrganizationMetadata, hyperNormalizeTags, hyperOrganizationMetadata, hyperOrganizationPages } from './HyperOrganizationModel';

function page(id: string, name: string, extra = '{}') {
  return create(ViewPBSchema, { id, name, layout: ViewLayoutPB.Document, oneOfExtra: { case: 'extra', value: extra } });
}
describe('Hyper organization metadata and filtering', () => {
  it('merges tags while preserving all existing workspace and editor metadata', () => {
    const view = page('a', 'Page', JSON.stringify({ cover: { type: '2', value: 'cover.png' }, font_layout: 'large', unknown: 123, hyperOrganization: { journalDate: '2026-11-10', futureProperty: 'keep' } }));
    const updated = JSON.parse(hyperMergeOrganizationMetadata(view, { tags: [' Work ', 'work', '', 'Team'] }));
    expect(updated).toEqual({ cover: { type: '2', value: 'cover.png' }, font_layout: 'large', unknown: 123, hyperOrganization: { journalDate: '2026-11-10', futureProperty: 'keep', tags: ['Work', 'Team'] } });
  });
  it('reads malformed metadata safely but refuses to overwrite it', () => {
    for (const value of ['{bad', '[]', 'null', '{"hyperOrganization":3}']) {
      const view = page('a', 'Page', value);
      expect(hyperOrganizationMetadata(view)).toEqual({ tags: [] });
      expect(() => hyperMergeOrganizationMetadata(view, { tags: ['tag'] })).toThrow();
    }
  });
  it('normalizes tags without changing the spelling of the first occurrence', () => {
    expect(hyperNormalizeTags([' Team ', 'team', 'Docs', '  ', 'DOCS'])).toEqual(['Team', 'Docs']);
    expect(hyperOrganizationMetadata(page('a', '', '{"hyperOrganization":{"tags":[false,1,"Team","team"]}}'))).toEqual({ tags: ['Team'] });
  });
  it('rejects impossible dates including leap days and keeps local calendar dates', () => {
    for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-1-01', '0000-01-01']) expect(hyperIsJournalDate(date)).toBe(false);
    for (const date of ['2024-02-29', '2026-11-10', '0099-01-01']) expect(hyperIsJournalDate(date)).toBe(true);
    expect(hyperLocalJournalDate(new Date(2026, 10, 10, 0, 1))).toBe('2026-11-10');
  });
  it('filters search, case-insensitive tags and journals then sorts without precision loss', () => {
    const first = page('a', 'Zebra', '{"hyperOrganization":{"tags":["Team"],"journalDate":"2026-11-10"}}');
    const second = page('b', 'Alpha', '{"hyperOrganization":{"tags":["Team"]}}');
    first.lastEdited = 9007199254740993n; second.lastEdited = 9007199254740992n;
    const filter = { query: '', tag: 'TEAM', journalsOnly: false, sort: 'edited' as const };
    expect(hyperFilterOrganizationPages([second, first], filter).map(view => view.id)).toEqual(['a', 'b']);
    expect(hyperFilterOrganizationPages([first, second], { ...filter, journalsOnly: true }).map(view => view.id)).toEqual(['a']);
    expect(hyperFilterOrganizationPages([first, second], { ...filter, query: 'alpha' }).map(view => view.id)).toEqual(['b']);
    expect(hyperFilterOrganizationPages([first, second], { ...filter, sort: 'name' }).map(view => view.id)).toEqual(['b', 'a']);
  });
  it('omits spaces, de-duplicates pages and keeps unreadable metadata visible', () => {
    const a = page('a', 'Page');
    expect(hyperOrganizationPages([a, page('space', 'Space', '{"is_space":true}'), a, page('b', 'Broken', '{bad')]).map(view => view.id)).toEqual(['a', 'b']);
  });
});
