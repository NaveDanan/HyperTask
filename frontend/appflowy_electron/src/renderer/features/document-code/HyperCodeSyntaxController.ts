import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText } from '../document/HyperDocumentModel';
import { hyperCodeSource } from './HyperDocumentCodeModel';
import { hyperCodeLanguage } from './HyperDocumentCodeValue';
import { HyperCodeSyntaxClient } from './HyperCodeSyntaxClient';
import { hyperClearCodeSyntax, hyperCodeSyntaxAvailable, hyperPaintCodeSyntax } from './HyperCodeSyntaxRegistry';
import { hyperCodeSyntaxMarkSignature, hyperCodeSyntaxRanges, hyperCodeSyntaxRespectMarks } from './HyperCodeSyntaxRanges';
import { hyperCodeSyntaxLimits, hyperCodeSyntaxSource } from './HyperCodeSyntaxTypes';
interface Block { lease: object; version: number; signature: string; timer?: ReturnType<typeof setTimeout> }
export class HyperCodeSyntaxController {
  private readonly blocks = new Map<HTMLElement, Block>();
  private readonly composing = new Set<HTMLElement>();
  private readonly observed = new Set<HTMLElement>();
  private readonly visible = new Set<HTMLElement>();
  private structureDirty = true;
  private disposed = false;
  private scrollTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly observer: MutationObserver;
  private readonly intersections?: IntersectionObserver;
  private readonly resize?: ResizeObserver;
  private readonly onCompositionStart: (event: Event) => void;
  private readonly onCompositionEnd: (event: Event) => void;
  private readonly onInput: (event: Event) => void;
  private readonly onScroll: () => void;
  constructor(private readonly host: HTMLElement, private readonly client: HyperCodeSyntaxClient, private readonly document: () => DocumentDataPB | null, private readonly current: () => boolean) {
    const target = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLElement>('[data-hyper-text]') : null;
    this.onCompositionStart = event => { const element = target(event); if (element) { this.composing.add(element); this.invalidate(element); } };
    this.onCompositionEnd = event => { const element = target(event); if (element) { this.composing.delete(element); this.invalidate(element); queueMicrotask(() => this.sync()); } };
    this.onInput = event => { const element = target(event); if (element) this.invalidate(element); };
    this.onScroll = () => { if (!this.disposed && !this.scrollTimer) this.scrollTimer = setTimeout(() => { this.scrollTimer = undefined; this.sync(); }, 80); };
    host.addEventListener('compositionstart', this.onCompositionStart, true); host.addEventListener('compositionend', this.onCompositionEnd, true); host.addEventListener('input', this.onInput, true); host.addEventListener('scroll', this.onScroll, true);
    this.observer = new MutationObserver(records => {
      for (const record of records) { if (record.type !== 'characterData') this.structureDirty = true; const element = (record.target.nodeType === 1 ? record.target as Element : record.target.parentElement)?.closest<HTMLElement>('[data-hyper-text]'); if (element) this.invalidate(element); }
      this.sync();
    });
    this.observer.observe(host, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'data-hyper-text'] });
    const view = host.ownerDocument.defaultView;
    if (view?.IntersectionObserver) this.intersections = new view.IntersectionObserver(entries => {
      if (this.disposed) return;
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (!this.observed.has(element)) continue;
        if (entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0) this.visible.add(element);
        else { this.visible.delete(element); this.invalidate(element); }
      }
      this.onScroll();
    }, { root: null, rootMargin: '200px 0px' });
    if (view?.ResizeObserver) { this.resize = new view.ResizeObserver(this.onScroll); this.resize.observe(host); }
    view?.addEventListener('resize', this.onScroll);
    host.ownerDocument.fonts?.addEventListener('loadingdone', this.onScroll);
  }
  private invalidate(element: HTMLElement) { const block = this.blocks.get(element); if (!block) return; block.version++; block.signature = ''; clearTimeout(block.timer); block.timer = undefined; this.client.cancel(block.lease); hyperClearCodeSyntax(element.ownerDocument, block.lease); }
  private reconcile(doc: DocumentDataPB) {
    if (!this.structureDirty || !this.intersections) return;
    this.structureDirty = false;
    const found = new Set<HTMLElement>(), walker = this.host.ownerDocument.createTreeWalker(this.host, 1);
    let node: Node | null, scanned = 0;
    // Bound traversal itself, including offscreen and non-code elements. Blocks
    // beyond this budget remain exact plain text instead of triggering more work.
    while (scanned < hyperCodeSyntaxLimits.layoutNodes && found.size < hyperCodeSyntaxLimits.observedBlocks && (node = walker.nextNode())) {
      scanned++;
      const element = node as HTMLElement;
      if (!element.matches('.hyper-code-syntax[data-hyper-text]') || doc.blocks[element.dataset.hyperText ?? '']?.ty !== 'code') continue;
      found.add(element);
      if (!this.observed.has(element)) { this.observed.add(element); this.intersections.observe(element); }
    }
    for (const element of this.observed) if (!found.has(element)) {
      this.intersections.unobserve(element); this.observed.delete(element); this.visible.delete(element); this.invalidate(element);
    }
  }
  sync() {
    if (this.disposed) return;
    if (!this.current() || !this.client.isCurrent()) { this.dispose(); return; }
    const doc = this.document(); if (!doc) return;
    this.reconcile(doc);
    for (const element of this.composing) if (!this.host.contains(element) || doc.blocks[element.dataset.hyperText ?? '']?.ty !== 'code') this.composing.delete(element);
    for (const element of this.blocks.keys()) if (!this.host.contains(element) || !this.visible.has(element) || doc.blocks[element.dataset.hyperText ?? '']?.ty !== 'code') { this.invalidate(element); this.blocks.delete(element); }
    let scanned = 0;
    const selected = new Set<HTMLElement>();
    for (const element of this.visible) {
      if (++scanned > hyperCodeSyntaxLimits.visibleBlocks) break;
      const id = element.dataset.hyperText!, model = doc.blocks[id]; if (model?.ty !== 'code' || !hyperCodeSyntaxAvailable(element.ownerDocument)) continue;
      selected.add(element);
      if (this.composing.has(element)) continue;
      const runs = hyperBlockText(doc, model), marks = hyperCodeSyntaxMarkSignature(runs); if (!marks) { this.invalidate(element); continue; }
      let source: string, language: string | null;
      try { source = hyperCodeSource(doc, id); language = hyperCodeLanguage(model).value; } catch { this.invalidate(element); continue; }
      if (!hyperCodeSyntaxSource(source) || element.textContent !== source) { this.invalidate(element); continue; }
      const signature = JSON.stringify([source, language, marks]);
      let block = this.blocks.get(element);
      if (!block) { block = { lease: {}, version: 0, signature: '' }; this.blocks.set(element, block); }
      if (block.signature === signature) continue;
      this.invalidate(element); block.signature = signature; const version = block.version, captured = block;
      const fresh = () => !this.disposed && this.current() && this.client.isCurrent() && this.host.contains(element) && element.isConnected && !this.composing.has(element) && this.blocks.get(element) === captured && captured.version === version && captured.signature === signature && element.textContent === source && (() => { const current = this.document(), currentBlock = current?.blocks[id]; try { return !!current && currentBlock?.ty === 'code' && hyperCodeSource(current, id) === source && hyperCodeLanguage(currentBlock).value === language && hyperCodeSyntaxMarkSignature(hyperBlockText(current, currentBlock)) === marks; } catch { return false; } })();
      block.timer = setTimeout(() => {
        captured.timer = undefined; if (!fresh()) return;
        void this.client.request(captured.lease, source, language, fresh).then(reply => {
          if (!fresh()) return;
          if (!reply || reply.status === 'plain') return;
          const ranges = hyperCodeSyntaxRespectMarks(hyperCodeSyntaxRanges(reply.html, source, element.ownerDocument), runs);
          if (fresh() && !hyperPaintCodeSyntax(element, captured.lease, source, ranges)) captured.signature = '';
        });
      }, 120);
    }
    for (const element of this.blocks.keys()) if (!selected.has(element)) { this.invalidate(element); this.blocks.delete(element); }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.observer.disconnect(); this.intersections?.disconnect(); this.resize?.disconnect(); clearTimeout(this.scrollTimer);
    this.host.removeEventListener('compositionstart', this.onCompositionStart, true); this.host.removeEventListener('compositionend', this.onCompositionEnd, true); this.host.removeEventListener('input', this.onInput, true); this.host.removeEventListener('scroll', this.onScroll, true);
    this.host.ownerDocument.defaultView?.removeEventListener('resize', this.onScroll); this.host.ownerDocument.fonts?.removeEventListener('loadingdone', this.onScroll);
    for (const [element, block] of this.blocks) { clearTimeout(block.timer); this.client.cancel(block.lease); hyperClearCodeSyntax(element.ownerDocument, block.lease); }
    this.blocks.clear(); this.composing.clear(); this.observed.clear(); this.visible.clear();
  }
}
