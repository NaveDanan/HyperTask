import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';

export interface HyperOrganizationMetadata {
  tags: string[];
  journalDate?: string;
}
export type HyperOrganizationFilter = { query: string; tag: string | null; journalsOnly: boolean; sort: 'edited' | 'name' | 'created' };

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Read unknown or older metadata without changing it. Mutations validate before writing. */
export function hyperOrganizationMetadata(view: Pick<ViewPB, 'oneOfExtra'>): HyperOrganizationMetadata {
  try {
    const extra: unknown = view.oneOfExtra.case === 'extra' ? JSON.parse(view.oneOfExtra.value) : {};
    const metadata = object(extra) && object(extra.hyperOrganization) ? extra.hyperOrganization : {};
    const tags = Array.isArray(metadata.tags) ? metadata.tags.filter((tag): tag is string => typeof tag === 'string') : [];
    return { tags: hyperNormalizeTags(tags), ...(typeof metadata.journalDate === 'string' && hyperIsJournalDate(metadata.journalDate) ? { journalDate: metadata.journalDate } : {}) };
  } catch { return { tags: [] }; }
}

export function hyperNormalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags.map(tag => tag.trim()).filter(tag => {
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function hyperMergeOrganizationMetadata(view: Pick<ViewPB, 'oneOfExtra'>, patch: Partial<HyperOrganizationMetadata>): string {
  const raw = view.oneOfExtra.case === 'extra' && view.oneOfExtra.value ? JSON.parse(view.oneOfExtra.value) as unknown : {};
  if (!object(raw)) throw new Error('Page metadata is not an object. It has not been changed.');
  if (raw.hyperOrganization !== undefined && !object(raw.hyperOrganization)) throw new Error('Organization metadata is invalid. It has not been changed.');
  if (patch.journalDate !== undefined && !hyperIsJournalDate(patch.journalDate)) throw new Error('Choose a valid journal date.');
  return JSON.stringify({ ...raw, hyperOrganization: { ...raw.hyperOrganization as Record<string, unknown> | undefined, ...patch, ...(patch.tags ? { tags: hyperNormalizeTags(patch.tags) } : {}) } });
}

export function hyperIsJournalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Date.UTC maps years 0..99 to 1900..1999. setUTCFullYear avoids that special case.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function hyperLocalJournalDate(date = new Date()): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The core already omits trash and inaccessible private pages in GetAllViews. */
export function hyperOrganizationPages(views: ViewPB[]): ViewPB[] {
  const unique = new Map<string, ViewPB>();
  for (const view of views) {
    let isSpace = false;
    try { isSpace = view.oneOfExtra.case === 'extra' && JSON.parse(view.oneOfExtra.value).is_space === true; } catch { /* Keep pages with unreadable metadata visible. */ }
    if (!isSpace) unique.set(view.id, view);
  }
  return [...unique.values()];
}

export function hyperFilterOrganizationPages(views: ViewPB[], filter: HyperOrganizationFilter): ViewPB[] {
  const query = filter.query.trim().toLocaleLowerCase(), tag = filter.tag?.toLocaleLowerCase();
  return views.filter(view => {
    const metadata = hyperOrganizationMetadata(view);
    return (!filter.journalsOnly || view.layout === ViewLayoutPB.Document && !!metadata.journalDate)
      && (!tag || metadata.tags.some(value => value.toLocaleLowerCase() === tag))
      && (!query || `${view.name} ${metadata.tags.join(' ')} ${metadata.journalDate ?? ''}`.toLocaleLowerCase().includes(query));
  }).sort((a, b) => {
    if (filter.sort === 'name') return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    const aTime = filter.sort === 'created' ? a.createTime : a.lastEdited;
    const bTime = filter.sort === 'created' ? b.createTime : b.lastEdited;
    return aTime > bTime ? -1 : aTime < bTime ? 1 : a.id.localeCompare(b.id);
  });
}
