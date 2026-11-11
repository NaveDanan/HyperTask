import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { FolderEventGetAllViews, FolderEventGetView, FolderEventReadCurrentWorkspace } from '@/backend/events/flowy-folder';
import { UserEventGetUserProfile } from '@/backend/events/flowy-user';
import { DocumentEventGetDocumentData } from '@/backend/events/flowy-document';
import { unwrap } from '@/backend/dispatch';
import { flushHyperDocument } from '../document/HyperDocumentSession';
import { hyperBlockText, hyperChildren, hyperPlainText, type HyperTextRun } from '../document/HyperDocumentModel';

export interface HyperLinkIdentity { workspaceId: string; userId: string }
export interface HyperLinkBackend {
  identity(): Promise<HyperLinkIdentity>;
  views(): Promise<ViewPB[]>;
  view(id: string): Promise<ViewPB>;
  document(id: string): Promise<DocumentDataPB>;
}
const backend: HyperLinkBackend = {
  identity: async () => ({ workspaceId: unwrap(await FolderEventReadCurrentWorkspace()).id, userId: String(unwrap(await UserEventGetUserProfile()).id) }),
  views: async () => unwrap(await FolderEventGetAllViews()).items,
  view: async value => unwrap(await FolderEventGetView({ value })),
  document: async documentId => { await flushHyperDocument(documentId); return unwrap(await DocumentEventGetDocumentData({ documentId })); },
};
export function hyperPageMention(pageId: string): HyperTextRun[] {
  if (!pageId) throw new Error('Choose a page');
  return [{ insert: '$', attributes: { mention: { type: 'page', page_id: pageId } } }];
}
export interface HyperBacklink { view: ViewPB; blockIds: string[]; preview: string }
export interface HyperBacklinkProgress { completed: number; total: number; links: HyperBacklink[]; failures: Array<{ id: string; message: string }> }
export function hyperDocumentReferences(document: DocumentDataPB, pageId: string): { blockIds: string[]; preview: string } {
  const visited = new Set<string>(), stack = [document.pageId], blockIds: string[] = [];
  let preview = '';
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) throw new Error('Document contains a repeated block');
    visited.add(id);
    const block = document.blocks[id];
    if (!block) throw new Error('Document contains a missing block');
    const text = hyperBlockText(document, block);
    if (text.some(run => {
      const mention = run.attributes?.mention;
      return mention && typeof mention === 'object' && 'type' in mention && mention.type === 'page' && 'page_id' in mention && mention.page_id === pageId;
    })) { blockIds.push(id); preview ||= hyperPlainText(text).slice(0, 240); }
    stack.push(...[...hyperChildren(document, block)].reverse());
  }
  return { blockIds, preview };
}
const message = (error: unknown) => (error as { msg?: string; message?: string })?.msg ?? (error as Error)?.message ?? String(error);
export class HyperDocumentLinkService {
  constructor(private readonly api: HyperLinkBackend = backend) {}
  private check(signal?: AbortSignal) { if (signal?.aborted) throw new Error('The page-link request was cancelled'); }
  async assertIdentity(expected: HyperLinkIdentity, signal?: AbortSignal) {
    this.check(signal);
    const actual = await this.api.identity();
    this.check(signal);
    if (actual.userId !== expected.userId || actual.workspaceId !== expected.workspaceId) throw new Error('The workspace or signed-in user changed. Reopen page links.');
  }
  async pages(signal?: AbortSignal) {
    this.check(signal);
    const identity = await this.api.identity();
    const views = await this.api.views();
    await this.assertIdentity(identity, signal);
    // GetAllViews includes the workspace's structural root with Document layout even
    // though it has no document collab. It is not a page or a backlink source.
    return { identity, views: views.filter(view => {
      if (view.id === identity.workspaceId) return false;
      try { return !(view.oneOfExtra.case === 'extra' && JSON.parse(view.oneOfExtra.value).is_space === true); }
      catch { return true; }
    }) };
  }
  async insertTarget(id: string, identity: HyperLinkIdentity, signal?: AbortSignal) {
    await this.assertIdentity(identity, signal);
    const view = await this.api.view(id);
    await this.assertIdentity(identity, signal);
    if (view.id !== id) throw new Error('The linked page is no longer available.');
    return view;
  }
  async backlinks(targetId: string, report: (progress: HyperBacklinkProgress) => void, signal?: AbortSignal): Promise<HyperBacklinkProgress> {
    const { identity, views } = await this.pages(signal);
    await this.insertTarget(targetId, identity, signal);
    const documents = views.filter(view => view.layout === ViewLayoutPB.Document && view.id !== targetId);
    const progress: HyperBacklinkProgress = { completed: 0, total: documents.length, links: [], failures: [] };
    let next = 0, stopped = false;
    const publish = () => { if (!stopped && !signal?.aborted) report({ ...progress, links: [...progress.links], failures: [...progress.failures] }); };
    publish();
    const worker = async () => {
      while (!stopped && next < documents.length) {
        this.check(signal);
        const candidate = documents[next++];
        await this.assertIdentity(identity, signal);
        try {
          const view = await this.api.view(candidate.id);
          const document = await this.api.document(view.id);
          await this.api.view(view.id);
          await this.assertIdentity(identity, signal);
          const reference = hyperDocumentReferences(document, targetId);
          if (reference.blockIds.length) progress.links.push({ view, ...reference });
        } catch (error) {
          await this.assertIdentity(identity, signal);
          progress.failures.push({ id: candidate.id, message: message(error) });
        }
        progress.completed++;
        publish();
      }
    };
    try { await Promise.all(Array.from({ length: Math.min(3, documents.length) }, worker)); }
    catch (error) { stopped = true; throw error; }
    await this.assertIdentity(identity, signal);
    return progress;
  }
}
