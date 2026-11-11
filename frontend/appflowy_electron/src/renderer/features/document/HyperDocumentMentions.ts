import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { FolderEventGetView } from '@/backend/events/flowy-folder';
import { unwrap } from '@/backend/dispatch';
import { tabsActions } from '../tabs/tabs-store';
import { listenView } from '../view-header/view-listener';
import { hyperBlockText, hyperEditText, hyperInsertBlock, hyperSliceText, hyperTextLength, hyperTextTypes, type HyperDocumentChange, type HyperTextRun } from './HyperDocumentModel';
import type { HyperTextSelection } from './HyperDocumentDom';

export const hyperDocumentMentionStrings = { loading: 'Loading page…', unavailable: 'Page unavailable', untitled: 'Untitled', open: 'Open page' } as const;
export interface HyperMentionBackend {
  view(id: string): Promise<ViewPB>;
  listen(id: string, refresh: () => void, unavailable: () => void): () => void;
  open(view: ViewPB): void | Promise<void>;
}
const backend: HyperMentionBackend = {
  view: async value => unwrap(await FolderEventGetView({ value })),
  listen: (id, refresh, unavailable) => listenView(id, { onViewUpdated: refresh, onViewMoveToTrash: unavailable, onViewDeleted: unavailable, onViewRestored: refresh }),
  open: view => tabsActions.openView(view),
};
type Labels = { [K in keyof typeof hyperDocumentMentionStrings]: string };
interface Entry { id: string; anchors: Set<HTMLAnchorElement>; status: 'loading' | 'ready' | 'unavailable'; view: ViewPB | null; version: number; stop(): void }

/** Only targets mounted in this editor are queried or observed. Titles are revalidated by
 * GetView before rendering notification changes and again before navigation. */
export class HyperDocumentMentionResolver {
  private entries = new Map<string, Entry>();
  private labels: Labels = hyperDocumentMentionStrings;
  private disposed = false;
  private pending = new Map<Entry, number>();
  private reading = 0;
  constructor(private readonly api: HyperMentionBackend = backend) {}
  setLabels(labels: Labels) { this.labels = labels; for (const entry of this.entries.values()) this.paint(entry); }
  private paint(entry: Entry) {
    const available = entry.status === 'ready' && entry.view !== null;
    const name = available ? entry.view!.name || this.labels.untitled : entry.status === 'loading' ? this.labels.loading : this.labels.unavailable;
    for (const anchor of entry.anchors) {
      if (anchor.textContent !== name) anchor.textContent = name;
      anchor.setAttribute('aria-label', available ? `${this.labels.open}: ${name}` : name);
      anchor.setAttribute('aria-disabled', String(!available));
      anchor.classList.toggle('text-primary', available);
      anchor.classList.toggle('text-muted-foreground', !available);
      if (available) anchor.href = '#'; else anchor.removeAttribute('href');
    }
  }
  private invalidate(entry: Entry) { this.pending.delete(entry); entry.version++; entry.view = null; entry.status = 'unavailable'; this.paint(entry); }
  private refresh(entry: Entry) {
    const version = ++entry.version;
    entry.view = null; entry.status = 'loading'; this.paint(entry);
    this.pending.set(entry, version);
    this.drain();
  }
  private drain() {
    while (!this.disposed && this.reading < 4 && this.pending.size) {
      const [entry, version] = this.pending.entries().next().value!;
      this.pending.delete(entry);
      if (this.entries.get(entry.id) !== entry || !entry.anchors.size || entry.version !== version) continue;
      this.reading++;
      void this.read(entry, version).finally(() => { this.reading--; this.drain(); });
    }
  }
  private async read(entry: Entry, version: number) {
    try {
      const view = await this.api.view(entry.id);
      if (this.disposed || this.entries.get(entry.id) !== entry || entry.version !== version || !entry.anchors.size) return;
      if (view.id !== entry.id) { this.invalidate(entry); return; }
      entry.view = view; entry.status = 'ready'; this.paint(entry);
    } catch { if (!this.disposed && this.entries.get(entry.id) === entry && entry.version === version) this.invalidate(entry); }
  }
  private bind(anchor: HTMLAnchorElement): () => void {
    const id = anchor.dataset.hyperMentionId!;
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { id, anchors: new Set(), status: 'loading', view: null, version: 0, stop() {} };
      this.entries.set(id, entry);
      const owned = entry;
      entry.stop = this.api.listen(id, () => { void this.refresh(owned); }, () => this.invalidate(owned));
    }
    const owned = entry;
    owned.anchors.add(anchor); this.paint(owned);
    if (owned.anchors.size === 1) void this.refresh(owned);
    const click = async (event: MouseEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (this.disposed || owned.status !== 'ready') return;
      const version = owned.version;
      try {
        const view = await this.api.view(id);
        if (this.disposed || !owned.anchors.has(anchor) || version !== owned.version) return;
        if (view.id !== id) { this.invalidate(owned); return; }
        await this.api.open(view);
      } catch { if (!this.disposed && owned.anchors.has(anchor)) this.invalidate(owned); }
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      event.preventDefault(); event.stopPropagation(); anchor.click();
    };
    anchor.addEventListener('click', click);
    anchor.addEventListener('keydown', keydown);
    return () => {
      anchor.removeEventListener('click', click); anchor.removeEventListener('keydown', keydown); owned.anchors.delete(anchor);
      if (!owned.anchors.size) { this.pending.delete(owned); owned.version++; owned.stop(); this.entries.delete(id); }
    };
  }
  watch(root: HTMLElement): () => void {
    this.disposed = false;
    const bound = new Map<HTMLAnchorElement, { id: string; release(): void }>();
    const sync = () => {
      if (this.disposed) return;
      const current = new Set(root.querySelectorAll<HTMLAnchorElement>('a[data-hyper-mention-id]'));
      for (const [anchor, binding] of bound) if (!current.has(anchor) || anchor.dataset.hyperMentionId !== binding.id) { binding.release(); bound.delete(anchor); }
      for (const anchor of current) if (!bound.has(anchor)) bound.set(anchor, { id: anchor.dataset.hyperMentionId!, release: this.bind(anchor) });
    };
    sync();
    const observer = new MutationObserver(sync); observer.observe(root, { childList: true, subtree: true });
    return () => { observer.disconnect(); for (const binding of bound.values()) binding.release(); bound.clear(); };
  }
  dispose() { this.disposed = true; this.pending.clear(); for (const entry of this.entries.values()) { entry.version++; entry.stop(); entry.stop = () => {}; } this.entries.clear(); }
}

export interface HyperMentionSelection { id: string; selection: HyperTextSelection; runs: string }
export function hyperCaptureMentionSelection(doc: DocumentDataPB, current: { id: string; selection: HyperTextSelection } | null): HyperMentionSelection | null {
  if (!current) return null;
  const block = doc.blocks[current.id];
  if (!block || !hyperTextTypes.has(block.ty)) throw new Error('The selected block is no longer editable.');
  const runs = hyperBlockText(doc, block), { start, end } = current.selection;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > hyperTextLength(runs)) throw new Error('The text selection is no longer valid.');
  return { id: current.id, selection: { start, end }, runs: JSON.stringify(runs) };
}
export function hyperInsertMentionAtSelection(doc: DocumentDataPB, target: HyperMentionSelection | null, inserted: HyperTextRun[]): HyperDocumentChange {
  if (!target) {
    const root = doc.blocks[doc.pageId];
    if (!root) throw new Error('Document root is missing.');
    const children = doc.meta?.childrenMap[root.childrenId]?.children ?? [];
    const paragraph = hyperInsertBlock(doc, doc.pageId, children.at(-1) ?? '', 'paragraph');
    const edited = hyperEditText(paragraph.document, paragraph.focus!.id, inserted);
    return { document: edited.document, actions: [...paragraph.actions, ...edited.actions], focus: { id: paragraph.focus!.id, offset: hyperTextLength(inserted) } };
  }
  const current = hyperCaptureMentionSelection(doc, target);
  if (!current || current.runs !== target.runs) throw new Error('The text changed while choosing a page. Select the insertion point again.');
  const runs = hyperBlockText(doc, doc.blocks[target.id]);
  const change = hyperEditText(doc, target.id, [...hyperSliceText(runs, 0, target.selection.start), ...inserted, ...hyperSliceText(runs, target.selection.end)]);
  return { ...change, focus: { id: target.id, offset: target.selection.start + hyperTextLength(inserted) } };
}
