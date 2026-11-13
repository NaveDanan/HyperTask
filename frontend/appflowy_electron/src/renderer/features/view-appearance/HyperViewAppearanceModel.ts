import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { ViewIconTypePB } from '@shared/protobuf/flowy-folder/icon_pb';

export type HyperCoverType = 'none' | 'color' | 'gradient' | 'built_in' | 'custom' | 'local' | 'unsplash';
export interface HyperViewCover { type: HyperCoverType; value: string }
export type HyperAppearanceField = 'cover' | 'icon' | 'name';
export type HyperAppearanceValue = HyperViewCover | { ty: ViewIconTypePB; value: string } | string;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const HYPER_COVER_GRADIENTS = [
  'linear-gradient(160deg,#34BDAF,#B682D4)', 'linear-gradient(#4CC2CC,#E17570)',
  'linear-gradient(#AF70E0,#ED7196)', 'linear-gradient(#A348D6,#44A7DE)',
  'linear-gradient(202deg,#5749C9,#BB4997)', 'linear-gradient(#036FFA,#00B8E5)',
  'linear-gradient(218deg,#F0C6CF,#DECCE2,#CAD3F9)',
] as const;
export const hyperCoverGradientId = (index: number) => `appflowy_them_color_gradient${index + 1}`;
export function hyperViewImageUrl(value: string): string {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Use a complete HTTP or HTTPS image address.');
  let url: URL; try { url = new URL(value); } catch { throw new Error('Use a complete HTTP or HTTPS image address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Use an HTTP or HTTPS image address without embedded credentials.');
  return url.href;
}
export function hyperCoverColor(value: string): string {
  const tint = /^appflowy_them_color_tint([1-9])$/u.exec(value);
  if (tint) return `var(--afx-tint-${tint[1]})`;
  // AppFlowy Color.toHex() uses AARRGGBB; browser color pickers use RRGGBB.
  const argb = /^(?:0x|#)([\da-f]{2})([\da-f]{6})$/iu.exec(value);
  if (argb) return `#${argb[2]}${argb[1]}`;
  if (/^#[\da-f]{6}$/iu.test(value)) return value;
  throw new Error('This cover has an unsupported color. Its data was kept.');
}
export function hyperValidateViewCover(value: unknown): HyperViewCover {
  if (!object(value) || typeof value.type !== 'string' || typeof value.value !== 'string' || value.value.length > 8192) throw new Error('This cover has an unsupported format. Its data was kept.');
  const cover = { type: value.type as HyperCoverType, value: value.value };
  switch (cover.type) {
    case 'none': if (cover.value) throw new Error('The empty cover has unexpected data.'); break;
    case 'color': hyperCoverColor(cover.value); break;
    case 'gradient': if (!/^appflowy_them_color_gradient[1-7]$/u.test(cover.value)) throw new Error('This cover gradient is unavailable. Its data was kept.'); break;
    case 'built_in': if (!/^[1-6]$/u.test(cover.value)) throw new Error('This cover preset is unavailable. Its data was kept.'); break;
    case 'local': if (!/^(?:\/|[A-Za-z]:[\\/])/u.test(cover.value) || cover.value.includes('\0')) throw new Error('This cover is not a managed local image.'); break;
    case 'custom': case 'unsplash': hyperViewImageUrl(cover.value); break;
    default: throw new Error('This cover has an unsupported type. Its data was kept.');
  }
  return cover;
}
export function hyperAppearanceExtra(view: Pick<ViewPB, 'oneOfExtra'>): Record<string, unknown> {
  const raw = view.oneOfExtra.case === 'extra' ? view.oneOfExtra.value : '';
  if (!raw) return {};
  if (raw.length > 256 * 1024) throw new Error('Page appearance metadata is too large to edit. Its data was kept.');
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error('Page metadata is invalid. Its data was kept.'); }
  if (!object(value)) throw new Error('Page metadata has an unsupported format. Its data was kept.');
  return value;
}
/** Prefer explicit modern metadata, including none, and never migrate merely by reading. */
export function hyperReadViewCover(view: Pick<ViewPB, 'oneOfExtra'>, document?: DocumentDataPB | null): { cover: HyperViewCover; legacy: boolean } {
  const extra = hyperAppearanceExtra(view);
  if (Object.hasOwn(extra, 'cover')) return { cover: hyperValidateViewCover(extra.cover), legacy: false };
  let root: unknown;
  try { root = document?.blocks[document.pageId]?.data ? JSON.parse(document.blocks[document.pageId].data) : {}; } catch { throw new Error('The legacy cover metadata is invalid. Its data was kept.'); }
  if (!object(root) || !Object.hasOwn(root, 'cover_selection_type') || root.cover_selection_type === 'CoverType.none') return { cover: { type: 'none', value: '' }, legacy: false };
  if (typeof root.cover_selection !== 'string') throw new Error('The legacy cover has an unsupported format. Its data was kept.');
  const type = root.cover_selection_type === 'CoverType.color' ? 'color' : root.cover_selection_type === 'CoverType.asset' ? 'built_in' : root.cover_selection_type === 'CoverType.file' ? /^https?:/iu.test(root.cover_selection) ? 'custom' : 'local' : null;
  if (!type) throw new Error('The legacy cover has an unsupported type. Its data was kept.');
  return { cover: hyperValidateViewCover({ type, value: root.cover_selection }), legacy: true };
}
export function hyperValidateViewIcon(value: unknown): { ty: ViewIconTypePB; value: string } {
  if (!object(value) || typeof value.value !== 'string' || value.value.length > 8192 || ![0, 1, 2].includes(value.ty as number)) throw new Error('This page icon has an unsupported format.');
  if (value.value && value.ty === ViewIconTypePB.Url) {
    if (/^https?:/iu.test(value.value)) hyperViewImageUrl(value.value);
    else if (!/^(?:\/|[A-Za-z]:[\\/])/u.test(value.value) || value.value.includes('\0')) throw new Error('Choose a managed image or an HTTP or HTTPS image address.');
  } else if (value.value && value.ty === ViewIconTypePB.Icon) {
    let data: unknown; try { data = JSON.parse(value.value); } catch { throw new Error('This built-in icon is invalid.'); }
    if (!object(data) || typeof data.groupName !== 'string' || typeof data.iconName !== 'string' || !data.groupName || !data.iconName) throw new Error('This built-in icon is invalid.');
  } else if (value.ty === ViewIconTypePB.Emoji && value.value.length > 128) throw new Error('Choose a shorter page icon.');
  return { ty: value.ty as ViewIconTypePB, value: value.value };
}
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value; }
export function hyperLegacyCoverField(raw: string): string {
  let value: unknown; try { value = raw ? JSON.parse(raw) : {}; } catch { throw new Error('The legacy cover metadata is invalid. Its data was kept.'); }
  if (!object(value)) throw new Error('The page root has an unsupported format.');
  return JSON.stringify(stable([value.cover_selection_type ?? null, value.cover_selection ?? null]));
}
export function hyperAppearanceField(view: ViewPB, field: HyperAppearanceField): string {
  return JSON.stringify(stable(field === 'cover' ? hyperAppearanceExtra(view).cover ?? null : field === 'name' ? view.name : view.oneOfIcon.case === 'icon' && view.oneOfIcon.value.value ? { ty: view.oneOfIcon.value.ty, value: view.oneOfIcon.value.value } : null));
}
export function hyperMergeViewCover(view: ViewPB, cover: HyperViewCover): string {
  const extra = hyperAppearanceExtra(view); hyperValidateViewCover(cover);
  if (extra.cover !== undefined && !object(extra.cover)) throw new Error('The cover metadata changed. Its data was kept.');
  return JSON.stringify({ ...extra, cover: { ...(object(extra.cover) ? extra.cover : {}), ...cover } });
}
