import type { HyperSkillSelection } from './HyperSkillsPanel';
/** Maps only skill destinations. Callback credentials and unrelated query data are discarded. */
export function hyperSkillSelectionFromPath(path: string): HyperSkillSelection | undefined {
  const url = new URL(path, 'https://hyper-openbot.invalid');
  const match = /^\/(?:admin\/|settings\/)?skills(?:\/(.*))?$/.exec(url.pathname);
  if (!match) return undefined;
  const slug = match[1];
  if (slug === 'new' || url.searchParams.get('new') === 'true') return { page: 'new' };
  const edit = slug ?? url.searchParams.get('edit');
  if (!edit) return { page: 'list' };
  try { const value = decodeURIComponent(edit); return /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(value) ? { page: 'skill', slug: value } : undefined; } catch { return undefined; }
}
