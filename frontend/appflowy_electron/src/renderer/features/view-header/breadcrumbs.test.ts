import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { ViewPBSchema, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { buildBreadcrumbs, type Crumb } from './breadcrumbs';

const view = (id: string, extra?: Record<string, unknown>, locked = false): ViewPB =>
  create(ViewPBSchema, {
    id,
    name: id,
    parentViewId: id === 'root' ? '' : 'p',
    oneOfExtra: extra ? { case: 'extra', value: JSON.stringify(extra) } : { case: undefined },
    oneOfIsLocked: locked ? { case: 'isLocked', value: true } : { case: undefined },
  });

const path = (ids: string[]) => ids.map((id) => view(id));
const describeCrumbs = (crumbs: Crumb[]) =>
  crumbs.map((c) => (c.type === 'title' ? `${c.view.id}${c.editable ? '*' : ''}` : c.type === 'divider' ? '›' : c.type === 'ellipsis' ? '...' : 'Trash'));
const options = { isDeleted: false, isGuest: false, isEditable: true };

// docs/parity/02-home-shell.md §3.4.2 _buildViewTitles.
describe('buildBreadcrumbs', () => {
  it('skips the workspace root and makes only the last crumb editable', () => {
    const { crumbs, showSection } = buildBreadcrumbs(path(['root', 'a', 'b']), options);
    expect(describeCrumbs(crumbs)).toEqual(['a', '›', 'b*']);
    expect(showSection).toBe(true);
  });

  it('collapses deep paths to first › ... › parent › page', () => {
    const { crumbs } = buildBreadcrumbs(path(['root', 'a', 'b', 'c', 'd', 'e']), options);
    expect(describeCrumbs(crumbs)).toEqual(['a', '›', '...', '›', 'd', '›', 'e*']);
  });

  it('shows four levels without an ellipsis', () => {
    const { crumbs } = buildBreadcrumbs(path(['root', 'a', 'b', 'c']), options);
    expect(describeCrumbs(crumbs)).toEqual(['a', '›', 'b', '›', 'c*']);
  });

  it('renders nothing for a single view or no ancestors', () => {
    expect(buildBreadcrumbs(path(['root']), options)).toEqual({ crumbs: [], showSection: false });
    expect(buildBreadcrumbs([], options)).toEqual({ crumbs: [], showSection: false });
  });

  it('shows Trash › page for a deleted page, the title keeping its editable default', () => {
    const { crumbs, showSection } = buildBreadcrumbs(path(['root', 'a', 'b']), { ...options, isDeleted: true });
    expect(describeCrumbs(crumbs)).toEqual(['Trash', '›', 'b*']);
    expect(showSection).toBe(false);
  });

  it('keeps the last crumb uneditable when the page is locked or not editable', () => {
    const locked = [view('root'), view('a'), view('b', undefined, true)];
    expect(describeCrumbs(buildBreadcrumbs(locked, options).crumbs)).toEqual(['a', '›', 'b']);
    expect(describeCrumbs(buildBreadcrumbs(path(['root', 'a', 'b']), { ...options, isEditable: false }).crumbs)).toEqual(['a', '›', 'b']);
  });

  it('drops spaces for guests but keeps the bounds computed before the filter', () => {
    const views = [view('root'), view('space', { is_space: true }), view('a'), view('b'), view('c')];
    // Bounds from 5 views: ellipsis for 2 <= i < 3; after filtering [root, a, b, c].
    const { crumbs } = buildBreadcrumbs(views, { ...options, isGuest: true });
    expect(describeCrumbs(crumbs)).toEqual(['a', '›', '...', '›', 'c*']);
  });
});
