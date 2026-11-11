import { create } from '@bufbuild/protobuf';
import { createStore } from 'zustand';
import { ViewIconPBSchema } from '@shared/protobuf/flowy-folder/icon_pb';
import type { HyperImportedAsset } from '@shared/api';
import { AFAccessLevelPB, SharedViewSectionPB, ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { AFRolePB, AuthTypePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { FolderEventGetView, FolderEventGetSharedUsers, FolderEventGetSharedViewSection, FolderEventReadCurrentWorkspace, FolderEventUpdateView, FolderEventUpdateViewIcon, FolderEventListTrashItems } from '@/backend/events/flowy-folder';
import { UserEventGetAllWorkspace, UserEventGetUserProfile } from '@/backend/events/flowy-user';
import { DocumentEventGetDocumentData } from '@/backend/events/flowy-document';
import { unwrap, type FlowyResult } from '@/backend/dispatch';
import { useAppStore } from '@/startup/app-store';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { hyperDocumentOwnerKey, hyperGetDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureSearchOwner } from '../search/HyperSearchOwner';
import { hyperAppearanceExtra, hyperAppearanceField, hyperLegacyCoverField, hyperMergeViewCover, hyperValidateViewCover, hyperValidateViewIcon, type HyperAppearanceField, type HyperAppearanceValue, type HyperViewCover } from './HyperViewAppearanceModel';

export interface HyperAppearanceOwner { owner: HyperDocumentOwner; isCurrent(): boolean }
type Check = <T>(operation: () => Promise<T>) => Promise<T>;
export interface HyperViewAppearanceBackend {
  capture(owner?: HyperDocumentOwner): HyperAppearanceOwner | null;
  view(id: string): Promise<ViewPB>;
  validate(id: string, scope: HyperAppearanceOwner, check: Check): Promise<void>;
  update(id: string, field: HyperAppearanceField, value: HyperAppearanceValue, current: ViewPB): Promise<void>;
  importFile(path: string): Promise<HyperImportedAsset>;
  preview(path: string): Promise<string>;
  documentRoot?(documentId: string): Promise<string>;
  readIdentity?(scope: HyperAppearanceOwner, check: Check): Promise<void>;
}
let revision = 0, lastOwner = '', watched = false;
function ownerVersion() {
  const update = () => { const key = JSON.stringify([hyperDocumentOwnerKey(hyperGetDocumentOwner()), useAppStore.getState().launchId]); if (key !== lastOwner) { lastOwner = key; revision++; } };
  if (!watched) { watched = true; useWorkspaceStore.subscribe(update); useAppStore.subscribe(update); }
  update(); return revision;
}
export function hyperCaptureAppearanceOwner(owner: HyperDocumentOwner | null = hyperGetDocumentOwner()): HyperAppearanceOwner | null {
  const scope = hyperCaptureSearchOwner(owner), version = ownerVersion();
  return scope && owner ? { owner, isCurrent: () => version === ownerVersion() && scope.isCurrent() } : null;
}
export const hyperViewAppearanceBackend: HyperViewAppearanceBackend = {
  capture: owner => hyperCaptureAppearanceOwner(owner),
  view: async value => unwrap(await FolderEventGetView({ value })),
  async readIdentity(scope, check) {
    const workspace = unwrap(await check(() => FolderEventReadCurrentWorkspace())), user = unwrap(await check(() => UserEventGetUserProfile()));
    if (workspace.id !== scope.owner.workspaceId || String(user.id) !== scope.owner.actorId) throw new Error('The active workspace or account changed.');
  },
  async validate(id, scope, check) {
    const user = unwrap(await check(() => UserEventGetUserProfile())), workspace = unwrap(await check(() => FolderEventReadCurrentWorkspace()));
    if (workspace.id !== scope.owner.workspaceId || String(user.id) !== scope.owner.actorId) throw new Error('The active workspace or account changed.');
    const view = await check(() => hyperViewAppearanceBackend.view(id));
    if (view.id !== id || view.oneOfIsLocked.case === 'isLocked' && view.oneOfIsLocked.value) throw new Error('This page is unavailable or locked.');
    const trash = unwrap(await check(() => FolderEventListTrashItems()));
    if (trash.items.some(item => item.id === id)) throw new Error('This page is in Trash. Restore it before changing its appearance.');
    if (user.userAuthType === AuthTypePB.Local || user.workspaceType === WorkspaceTypePB.LocalW || view.oneOfCreatedBy.case === 'createdBy' && view.oneOfCreatedBy.value === user.id) return;
    const section = unwrap(await check(() => FolderEventGetSharedViewSection({ value: id })));
    const roles = unwrap(await check(() => UserEventGetAllWorkspace())).items, role = roles.find(item => item.workspaceId === workspace.id)?.oneOfRole;
    if (section.section === SharedViewSectionPB.PublicSection && role?.case === 'role' && [AFRolePB.Owner, AFRolePB.Member].includes(role.value)) return;
    const me = unwrap(await check(() => FolderEventGetSharedUsers({ viewId: id }))).items.find(item => item.email === user.email);
    if (!me || ![AFAccessLevelPB.FullAccess, AFAccessLevelPB.ReadAndWrite].includes(me.accessLevel)) throw new Error('You cannot change this page appearance.');
  },
  async update(viewId, field, value, current) {
    if (field === 'icon') unwrap(await FolderEventUpdateViewIcon({ viewId, oneOfIcon: { case: 'icon', value: hyperValidateViewIcon(value) } }));
    else unwrap(await FolderEventUpdateView({ viewId, ...(field === 'name' ? { oneOfName: { case: 'name' as const, value: value as string } } : { oneOfExtra: { case: 'extra' as const, value: hyperMergeViewCover(current, value as HyperViewCover) } }) }));
  },
  importFile: path => window.appflowy.assets.importFile(path, 'image'),
  preview: path => window.appflowy.assets.previewUrl(path),
  documentRoot: async documentId => { const document = unwrap(await DocumentEventGetDocumentData({ documentId })); const root = document.blocks[document.pageId]; if (!root) throw new Error('The page root is unavailable.'); return root.data; },
};
export interface HyperAppearanceTarget {
  viewId: string; layout: ViewLayoutPB; field: HyperAppearanceField; original: string;
  scope: HyperAppearanceOwner; editable(): boolean; sourceGuard?(): void;
  legacySource?: { documentId: string; original: string };
}
export interface HyperAppearanceRecovery { id: string; target: HyperAppearanceTarget; desired: HyperAppearanceValue; asset?: string; error: string; uncertain: boolean }
const message = (error: unknown) => (error as { msg?: string; message?: string })?.msg ?? (error as Error)?.message ?? String(error);
export class HyperViewAppearanceService {
  readonly store = createStore(() => ({ recoveries: [] as HyperAppearanceRecovery[] }));
  private queues = new Map<string, Promise<unknown>>();
  private listeners = new Set<(view: ViewPB, owner: HyperDocumentOwner) => void>();
  constructor(readonly api = hyperViewAppearanceBackend) {}
  subscribe(listener: (view: ViewPB, owner: HyperDocumentOwner) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private current(target: HyperAppearanceTarget) {
    if (!target.scope.isCurrent()) throw new Error('The workspace, account or app session changed. Reopen appearance settings.');
    if (!target.editable()) throw new Error('This page is read-only.');
    target.sourceGuard?.();
  }
  private check(target: HyperAppearanceTarget): Check { return async operation => { this.current(target); const result = await operation(); this.current(target); return result; }; }
  capture(view: ViewPB, field: HyperAppearanceField, editable = () => true, sourceGuard?: () => void, owner?: HyperDocumentOwner): HyperAppearanceTarget {
    const scope = this.api.capture(owner); if (!scope) throw new Error('The workspace or account is unavailable.');
    const target = { viewId: view.id, layout: view.layout, field, original: hyperAppearanceField(view, field), scope, editable, sourceGuard }; this.current(target);
    if (!view.id || field === 'cover' && view.layout !== ViewLayoutPB.Document) throw new Error('Covers are available on document pages.');
    if (field === 'cover' && Object.hasOwn(hyperAppearanceExtra(view), 'cover')) hyperValidateViewCover(hyperAppearanceExtra(view).cover);
    return target;
  }
  async read(view: ViewPB, owner?: HyperDocumentOwner): Promise<ViewPB> {
    const target = this.capture(view, 'icon', () => true, undefined, owner), check = this.check(target);
    if (this.api.readIdentity) await check(() => this.api.readIdentity!(target.scope, check));
    const result = await check(() => this.api.view(view.id));
    if (result.id !== view.id) throw new Error('The page changed.'); return result;
  }
  private async fresh(target: HyperAppearanceTarget) {
    const check = this.check(target); await check(() => this.api.validate(target.viewId, target.scope, check));
    const current = await check(() => this.api.view(target.viewId));
    if (current.id !== target.viewId || current.layout !== target.layout) throw new Error('The page layout changed. Reopen appearance settings.');
    if (target.legacySource) {
      if (!this.api.documentRoot) throw new Error('The original legacy cover cannot be checked.');
      const root = await check(() => this.api.documentRoot!(target.legacySource!.documentId));
      if (hyperLegacyCoverField(root) !== target.legacySource.original) throw new Error('The legacy cover changed. Reopen its picker before saving.');
    }
    return current;
  }
  private validate(target: HyperAppearanceTarget, desired: HyperAppearanceValue) {
    if (target.field === 'cover') return hyperValidateViewCover(desired);
    if (target.field === 'icon') return hyperValidateViewIcon(desired);
    if (typeof desired !== 'string' || !desired.trim() || desired.length > 256) throw new Error('Use a page name between 1 and 256 characters.');
    return desired;
  }
  private desiredField(target: HyperAppearanceTarget, desired: HyperAppearanceValue, current: ViewPB) {
    if (target.field === 'cover') { const copy = { ...current, oneOfExtra: { case: 'extra' as const, value: hyperMergeViewCover(current, desired as HyperViewCover) } }; return hyperAppearanceField(copy, 'cover'); }
    return hyperAppearanceField(target.field === 'name' ? { ...current, name: desired as string } : { ...current, oneOfIcon: { case: 'icon', value: create(ViewIconPBSchema, hyperValidateViewIcon(desired)) } }, target.field);
  }
  private retain(target: HyperAppearanceTarget, desired: HyperAppearanceValue, error: unknown, asset: string | undefined, uncertain: boolean) {
    const plan = { id: crypto.randomUUID(), target, desired, ...(asset ? { asset } : {}), error: message(error), uncertain };
    this.store.setState(state => ({ recoveries: [...state.recoveries, plan] })); return plan;
  }
  private enqueue<T>(target: HyperAppearanceTarget, action: () => Promise<T>): Promise<T> {
    this.current(target); const key = JSON.stringify([hyperDocumentOwnerKey(target.scope.owner), target.viewId]), previous = this.queues.get(key) ?? Promise.resolve();
    const request = previous.catch(() => {}).then(() => { this.current(target); return action(); }), settled = request.then(() => {}, () => {});
    this.queues.set(key, settled); void settled.then(() => { if (this.queues.get(key) === settled) this.queues.delete(key); }); return request;
  }
  private async write(target: HyperAppearanceTarget, desired: HyperAppearanceValue, asset?: string, recovery = false): Promise<ViewPB> {
    let attempted = false;
    try {
      this.validate(target, desired);
      if (target.field !== 'name' && typeof desired === 'object' && ('type' in desired && desired.type === 'local' || 'ty' in desired && desired.ty === 1 && !/^https?:/iu.test(desired.value))) await this.check(target)(() => this.api.preview(desired.value));
      const current = await this.fresh(target), desiredField = this.desiredField(target, desired, current);
      if (hyperAppearanceField(current, target.field) === desiredField) { this.listeners.forEach(listener => listener(current, target.scope.owner)); return current; }
      if (hyperAppearanceField(current, target.field) !== target.original) throw new Error('The page appearance changed while the picker was open. Reopen it before saving.');
      // Fresh-read and rebase unrelated metadata immediately before dispatch; core has no CAS.
      const latest = await this.fresh(target);
      if (hyperAppearanceField(latest, target.field) !== target.original) throw new Error('The page appearance changed while the picker was open.');
      this.current(target); attempted = true; await this.check(target)(() => this.api.update(target.viewId, target.field, desired, latest));
      const saved = await this.check(target)(() => this.api.view(target.viewId));
      if (saved.id !== target.viewId || hyperAppearanceField(saved, target.field) !== this.desiredField(target, desired, saved)) throw new Error('The appearance save was not confirmed.');
      this.listeners.forEach(listener => listener(saved, target.scope.owner)); return saved;
    } catch (error) { if (!recovery && (attempted || asset)) this.retain(target, desired, error, asset, attempted); throw error; }
  }
  private pending(target: HyperAppearanceTarget) { if (this.store.getState().recoveries.some(plan => plan.target.viewId === target.viewId && plan.target.field === target.field && hyperDocumentOwnerKey(plan.target.scope.owner) === hyperDocumentOwnerKey(target.scope.owner))) throw new Error('Check the pending appearance recovery before making another change.'); }
  save(target: HyperAppearanceTarget, desired: HyperAppearanceValue, asset?: string) { return this.enqueue(target, () => { this.pending(target); return this.write(target, desired, asset); }); }
  async importImage(target: HyperAppearanceTarget, source: string): Promise<HyperImportedAsset> {
    this.pending(target); await this.fresh(target); const asset = await this.api.importFile(source);
    try { this.current(target); await this.fresh(target); await this.check(target)(() => this.api.preview(asset.path)); }
    catch (error) { this.retain(target, target.field === 'cover' ? { type: 'local', value: asset.path } : { ty: 1, value: asset.path }, error, asset.path, false); throw error; }
    return asset;
  }
  dismiss(id: string) { this.store.setState(state => ({ recoveries: state.recoveries.filter(item => item.id !== id) })); }
  details(plan: HyperAppearanceRecovery) { return JSON.stringify({ action: 'finish-existing-appearance-only', viewId: plan.target.viewId, field: plan.target.field, desired: plan.desired, ...(plan.asset ? { savedAsset: plan.asset } : {}), uncertain: plan.uncertain, error: plan.error }, null, 2); }
  async retry(id: string, owner: HyperDocumentOwner) {
    const plan = this.store.getState().recoveries.find(item => item.id === id);
    if (!plan || hyperDocumentOwnerKey(owner) !== hyperDocumentOwnerKey(plan.target.scope.owner)) throw new Error('Return to the original workspace and account to finish this change.');
    const scope = this.api.capture(owner); if (!scope) throw new Error('The original workspace or account is unavailable.');
    const target = { ...plan.target, scope, editable: () => true };
    try { const saved = await this.enqueue(target, () => this.write(target, plan.desired, plan.asset, true)); this.dismiss(id); return saved; }
    catch (error) { this.store.setState(state => ({ recoveries: state.recoveries.map(item => item.id === id ? { ...item, error: message(error) } : item) })); throw error; }
  }
}
export const hyperViewAppearance = new HyperViewAppearanceService();
export async function hyperUpdateViewIcon(view: ViewPB, icon: { ty: number; value: string }, target?: HyperAppearanceTarget): Promise<FlowyResult<void>> {
  try { await hyperViewAppearance.save(target ?? hyperViewAppearance.capture(view, 'icon'), icon); return { ok: true, value: undefined }; }
  catch (error) { return { ok: false, error: create(FlowyErrorSchema, { code: ErrorCode.Internal, msg: message(error) }) }; }
}
