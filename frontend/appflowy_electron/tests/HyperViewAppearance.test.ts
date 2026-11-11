import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { clone, create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { ViewLayoutPB, ViewPBSchema, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { DocumentDataPBSchema, BlockPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ViewIconPBSchema } from '@shared/protobuf/flowy-folder/icon_pb';
import { HyperViewAppearanceService, hyperCaptureAppearanceOwner, type HyperViewAppearanceBackend } from '../src/renderer/features/view-appearance/HyperViewAppearanceService';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { useAppStore } from '../src/renderer/startup/app-store';
import { hyperAppearanceExtra, hyperAppearanceField, hyperCoverColor, hyperMergeViewCover, hyperReadViewCover, hyperValidateViewCover, hyperValidateViewIcon, hyperViewImageUrl } from '../src/renderer/features/view-appearance/HyperViewAppearanceModel';
const page = (extra: object = {}) => create(ViewPBSchema, { id: 'page', layout: ViewLayoutPB.Document, name: 'Page', oneOfExtra: { case: 'extra', value: JSON.stringify(extra) } });
const cover = { type: 'color' as const, value: '#123456' };
function fixture(initial = page()) {
  let saved = clone(ViewPBSchema, initial), current = true, allowed = true, pending: (() => Promise<void>) | undefined;
  const owner = { workspaceId: 'workspace', actorId: 'actor', contextKey: 'realm', isCurrent: () => current };
  const api: HyperViewAppearanceBackend = {
    capture: () => current ? { owner, isCurrent: () => current } : null,
    view: vi.fn(async () => clone(ViewPBSchema, saved)), validate: vi.fn(async () => { if (!allowed) throw Error('Locked'); }),
    update: vi.fn(async (_id, field, value, fresh) => { if (pending) await pending(); if (field === 'cover') saved.oneOfExtra = { case: 'extra', value: hyperMergeViewCover(fresh, value as typeof cover) }; else if (field === 'name') saved.name = value as string; else saved.oneOfIcon = { case: 'icon', value: create(ViewIconPBSchema, value as { ty: number; value: string }) }; }),
    importFile: vi.fn(async () => ({ path: '/managed/images/copied.png', name: 'photo.png', size: 12, previewUrl: 'appflowy-file://local/images/copied.png' })),
    preview: vi.fn(async () => 'appflowy-file://local/images/copied.png'),
  };
  const service = new HyperViewAppearanceService(api);
  return { api, service, owner, get: () => saved, set: (view: ViewPB) => { saved = view; }, switchOwner: () => { current = false; }, lock: () => { allowed = false; }, update: (callback: () => Promise<void>) => { pending = callback; } };
}
describe('Hyper page appearance compatibility', () => {
  it('reads modern cover tokens and non-mutating legacy root fallback, with explicit none taking precedence', () => {
    const doc = create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: create(BlockPBSchema, { id: 'root', ty: 'page', data: JSON.stringify({ cover_selection_type: 'CoverType.file', cover_selection: '/managed/images/old.png', selected_icon: '🌍', unknown: true }) }) } });
    const original = doc.blocks.root.data; expect(hyperReadViewCover(page(), doc)).toEqual({ cover: { type: 'local', value: '/managed/images/old.png' }, legacy: true }); expect(doc.blocks.root.data).toBe(original);
    expect(hyperReadViewCover(page({ cover: { type: 'none', value: '' } }), doc).cover.type).toBe('none');
    for (const type of ['custom', 'unsplash']) expect(hyperValidateViewCover({ type, value: 'https://example.org/photo' }).type).toBe(type);
    expect(hyperValidateViewCover({ type: 'gradient', value: 'appflowy_them_color_gradient7' }).type).toBe('gradient');
    expect(hyperCoverColor('0x80112233')).toBe('#11223380'); expect(hyperCoverColor('appflowy_them_color_tint9')).toBe('var(--afx-tint-9)');
  });
  it('preserves unrelated and future cover data while rejecting malformed or unavailable schemas', () => {
    const original = page({ font: 'Geist', future: { keep: 7 }, cover: { ...cover, future: ['keep'] } });
    expect(JSON.parse(hyperMergeViewCover(original, { type: 'none', value: '' }))).toEqual({ font: 'Geist', future: { keep: 7 }, cover: { type: 'none', value: '', future: ['keep'] } });
    for (const raw of ['[]', '{', 'null']) expect(() => hyperAppearanceExtra({ oneOfExtra: { case: 'extra', value: raw } })).toThrow();
    for (const value of [{ type: 'future', value: 'x' }, { type: 'gradient', value: '9' }, { type: 'built_in', value: '../1' }, { type: 'local', value: 'file:///etc/passwd' }, { type: 'color', value: 'url(https://bad)' }]) expect(() => hyperValidateViewCover(value)).toThrow();
    expect(() => fixture(page({ cover: { type: 'future', value: 'kept' } })).service.capture(page({ cover: { type: 'future', value: 'kept' } }), 'cover')).toThrow();
  });
  it('accepts credential-free HTTP(S), denies active/credential URL schemes and invalid icon formats', () => {
    expect(hyperViewImageUrl('https://example.org/image?q=one')).toBe('https://example.org/image?q=one');
    for (const value of ['javascript:alert(1)', 'data:image/svg+xml,x', 'file:///private.png', 'https://name:password@example.org/image', 'https://example.org/\nprivate']) expect(() => hyperViewImageUrl(value)).toThrow();
    expect(hyperValidateViewIcon({ ty: 2, value: JSON.stringify({ groupName: 'group', iconName: 'icon', color: null }) }).ty).toBe(2);
    for (const icon of [{ ty: 9, value: 'future' }, { ty: 1, value: 'data:image/png;base64,a' }, { ty: 2, value: '{}' }]) expect(() => hyperValidateViewIcon(icon)).toThrow();
  });
  it('bundles the six unchanged upstream presets with their license and source hashes', () => {
    const directory = path.resolve(__dirname, '../src/renderer/features/view-appearance/presets'), provenance = JSON.parse(fs.readFileSync(path.join(directory, 'provenance.json'), 'utf8'));
    expect(provenance.commit).toBe('8fcee27d9bd93aad4ee0191d5d8d915d6a9a4e93'); expect(provenance.files).toHaveLength(6);
    for (const asset of provenance.files) expect(createHash('sha256').update(fs.readFileSync(path.join(directory, asset.file))).digest('hex')).toBe(asset.sha256);
    expect(fs.readFileSync(path.join(directory, 'LICENSE'), 'utf8')).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
  });
});
describe('Hyper scoped page appearance mutations and recovery', () => {
  it('invalidates captured work across same-ID storage, account and launch ABA transitions', () => {
    const workspace = useWorkspaceStore.getState(), app = useAppStore.getState();
    try {
      useWorkspaceStore.setState({ currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace' }), userProfile: create(UserProfilePBSchema, { id: 7n }) }); useAppStore.setState({ dataDirectory: '/temporary/appearance-a' });
      const storage = hyperCaptureAppearanceOwner()!; useAppStore.setState({ dataDirectory: '/temporary/appearance-b' }); expect(storage.isCurrent()).toBe(false); useAppStore.setState({ dataDirectory: '/temporary/appearance-a' }); expect(storage.isCurrent()).toBe(false);
      const account = hyperCaptureAppearanceOwner()!; useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 8n }) }); useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 7n }) }); expect(account.isCurrent()).toBe(false);
      const launch = hyperCaptureAppearanceOwner()!; useAppStore.setState({ launchId: app.launchId + 1 }); useAppStore.setState({ launchId: app.launchId }); expect(launch.isCurrent()).toBe(false); expect(hyperCaptureAppearanceOwner()!.isCurrent()).toBe(true);
    } finally { useWorkspaceStore.setState({ currentWorkspace: workspace.currentWorkspace, userProfile: workspace.userProfile, actionResult: workspace.actionResult }); useAppStore.setState({ dataDirectory: app.dataDirectory, launchId: app.launchId }); }
  });
  it('rebases unrelated extra keys and blocks a changed selected cover', async () => {
    const f = fixture(page({ font: 'old', cover })), target = f.service.capture(f.get(), 'cover');
    f.set(page({ font: 'new', tags: ['keep'], cover })); const saved = await f.service.save(target, { type: 'none', value: '' }); expect(hyperAppearanceExtra(saved)).toEqual({ font: 'new', tags: ['keep'], cover: { type: 'none', value: '' } });
    const stale = f.service.capture(saved, 'cover'); f.set(page({ cover: { type: 'color', value: '#abcdef' } })); await expect(f.service.save(stale, cover)).rejects.toThrow('changed'); expect(f.api.update).toHaveBeenCalledOnce();
  });
  it('does not dispatch when owner, permission, layout or caller source becomes stale during awaits', async () => {
    for (const mode of ['owner', 'permission', 'layout', 'source']) {
      const f = fixture(); let source = true; const target = f.service.capture(f.get(), 'cover', () => true, () => { if (!source) throw Error('Source changed'); });
      f.api.validate = vi.fn(async () => { if (mode === 'owner') f.switchOwner(); if (mode === 'permission') throw Error('Locked'); if (mode === 'layout') f.set({ ...f.get(), layout: ViewLayoutPB.Grid }); if (mode === 'source') source = false; });
      await expect(f.service.save(target, cover)).rejects.toThrow(); expect(f.api.update).not.toHaveBeenCalled();
    }
  });
  it('serializes icon and cover saves from one owner without replacing unrelated fresh fields', async () => {
    const f = fixture(), iconTarget = f.service.capture(f.get(), 'icon'), coverTarget = f.service.capture(f.get(), 'cover');
    await Promise.all([f.service.save(iconTarget, { ty: 0, value: '🌍' }), f.service.save(coverTarget, cover)]);
    expect(f.get().oneOfIcon.value?.value).toBe('🌍'); expect(hyperReadViewCover(f.get()).cover).toEqual(cover);
  });
  it('keeps an imported image when the original owner disappears and never writes its metadata', async () => {
    const f = fixture(), target = f.service.capture(f.get(), 'cover'); f.api.importFile = vi.fn(async () => { f.switchOwner(); return { path: '/managed/images/kept.png', name: 'photo', size: 4, previewUrl: 'appflowy-file://local/images/kept.png' }; });
    await expect(f.service.importImage(target, '/source/photo.png')).rejects.toThrow(); expect(f.api.update).not.toHaveBeenCalled(); const plan = f.service.store.getState().recoveries[0]; expect(plan.asset).toBe('/managed/images/kept.png'); expect(f.service.details(plan)).toContain('finish-existing-appearance-only');
  });
  it('verifies local paths through managed preview before accepting either icon or cover metadata', async () => {
    for (const field of ['icon', 'cover'] as const) { const f = fixture(); f.api.preview = vi.fn(async () => { throw Error('Outside managed storage'); }); await expect(f.service.save(f.service.capture(f.get(), field), field === 'cover' ? { type: 'local', value: '/etc/private.png' } : { ty: 1, value: '/etc/private.png' })).rejects.toThrow('managed'); expect(f.api.update).not.toHaveBeenCalled(); }
  });
  it('retains an uncertain once-only write and explicitly confirms it without replay', async () => {
    const f = fixture(), target = f.service.capture(f.get(), 'cover'); let fail = true;
    const read = f.api.view; f.api.view = vi.fn(async id => { if (!fail && f.api.update && vi.mocked(f.api.update).mock.calls.length) throw Error('Lost read acknowledgement'); return read(id); });
    f.update(async () => { fail = false; }); await expect(f.service.save(target, cover, '/managed/images/kept.png')).rejects.toThrow('acknowledgement'); expect(f.api.update).toHaveBeenCalledOnce();
    await expect(f.service.save(target, cover)).rejects.toThrow('pending appearance recovery'); const plan = f.service.store.getState().recoveries[0]; f.api.view = read;
    await f.service.retry(plan.id, f.owner); expect(f.api.update).toHaveBeenCalledOnce(); expect(f.service.store.getState().recoveries).toHaveLength(0);
  });
  it('does not retry conflicting appearance or another owner, and dismissal only forgets recovery', async () => {
    const f = fixture(); f.update(async () => { throw Error('Uncertain native write'); }); await expect(f.service.save(f.service.capture(f.get(), 'icon'), { ty: 0, value: '🌍' })).rejects.toThrow();
    const plan = f.service.store.getState().recoveries[0]; await expect(f.service.retry(plan.id, { ...f.owner, contextKey: 'different server' })).rejects.toThrow('original');
    f.set({ ...f.get(), oneOfIcon: { case: 'icon', value: create(ViewIconPBSchema, { ty: 0, value: '🐶' }) } }); await expect(f.service.retry(plan.id, f.owner)).rejects.toThrow('changed'); expect(f.api.update).toHaveBeenCalledOnce();
    f.service.dismiss(plan.id); expect(f.get().oneOfIcon.value?.value).toBe('🐶'); expect(f.service.store.getState().recoveries).toHaveLength(0);
  });
  it('ignores map ordering when comparing the selected cover while preserving its unknown keys', () => {
    const a = page({ cover: { type: 'color', value: '#123456', unknown: { a: 1, b: 2 } } }), b = page({ cover: { unknown: { b: 2, a: 1 }, value: '#123456', type: 'color' } }); expect(hyperAppearanceField(a, 'cover')).toBe(hyperAppearanceField(b, 'cover'));
  });
});
