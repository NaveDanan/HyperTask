import { hyperCreateDocumentFootnoteElements } from '../document-footnote/HyperDocumentFootnoteValue';
import type { HyperTextRun } from './HyperDocumentModel';
import { hyperSafeUrl } from './HyperDocumentExport';
import { hyperDocumentColorAttribute, hyperDocumentColorCss } from '../document-format/HyperDocumentColor';
import { hyperCreateDocumentDateElement, hyperDocumentDateMention } from '../document-date/HyperDocumentDateValue';
import { hyperCreateInlineMathElements, hyperCreateInlineMathOverflow, hyperInlineMathPaintBudget, hyperInlineMathPaintLimits, type HyperInlineMathDomLabels } from '../document-inline-math/HyperInlineMathDom';
import { hyperReadInlineMath } from '../document-inline-math/HyperInlineMathValue';

function paintColors(element: HTMLElement, attributes: Record<string, unknown>) {
  const color = hyperDocumentColorCss(attributes.font_color), background = hyperDocumentColorCss(attributes.bg_color);
  if (color) element.style.color = color;
  if (background) element.style.backgroundColor = background;
}
function bindLink(link: HTMLAnchorElement, host: HTMLElement, href: string) {
  const open = () => { try { void Promise.resolve(window.appflowy.shell.openExternal(href)).catch(() => {}); } catch { /* Keep editing responsive if the system cannot open a link. */ } };
  link.addEventListener('click', event => {
    event.preventDefault();
    if (!host.isContentEditable || event.ctrlKey || event.metaKey) { event.stopPropagation(); open(); }
  });
  link.addEventListener('keydown', event => {
    if (event.key === 'Enter' && document.activeElement === link) { event.preventDefault(); event.stopPropagation(); open(); }
  });
}

export interface HyperTextSelection { start: number; end: number }
export function hyperPageMentionId(run: HyperTextRun): string | null {
  const mention = run.attributes?.mention;
  return typeof run.insert === 'string' && /^\$+$/.test(run.insert) && mention !== null && typeof mention === 'object' && 'type' in mention && mention.type === 'page' && 'page_id' in mention && typeof mention.page_id === 'string' && mention.page_id ? mention.page_id : null;
}
const atomic = (node: Node): node is HTMLElement => node instanceof HTMLElement && (node.dataset.hyperAtomic !== undefined || node.dataset.hyperEmbed !== undefined);
function atomicValue(node: HTMLElement): HyperTextRun['insert'] {
  return JSON.parse(node.dataset.hyperAtomic ?? node.dataset.hyperEmbed!);
}
export function hyperReadText(element: HTMLElement): HyperTextRun[] {
  const runs: HyperTextRun[] = [];
  function append(insert: HyperTextRun['insert'], attributes: Record<string, unknown>) {
    if (insert === '') return;
    const last = runs.at(-1);
    if (typeof last?.insert === 'string' && typeof insert === 'string' && JSON.stringify(last.attributes ?? {}) === JSON.stringify(attributes)) last.insert += insert;
    else runs.push(Object.keys(attributes).length ? { insert, attributes } : { insert });
  }
  function walk(node: Node, inherited: Record<string, unknown>) {
    if (node.nodeType === Node.TEXT_NODE) { append(node.textContent ?? '', inherited); return; }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.hyperInlineMathRuns !== undefined) { for (const run of JSON.parse(node.dataset.hyperInlineMathRuns) as HyperTextRun[]) runs.push(run); return; }
    let attributes = { ...inherited };
    if (node.dataset.hyperAttributes) attributes = JSON.parse(node.dataset.hyperAttributes);
    const name = node.tagName.toLowerCase();
    if (!node.dataset.hyperAttributes) {
      const color = hyperDocumentColorCss(node.style.color), background = hyperDocumentColorCss(node.style.backgroundColor);
      if (color) attributes.font_color = hyperDocumentColorAttribute(color);
      if (background) attributes.bg_color = hyperDocumentColorAttribute(background);
      if (name === 'a' && !node.dataset.hyperMentionId) {
        const href = hyperSafeUrl(node.getAttribute('href'));
        if (href) attributes.href = href;
      }
    }
    if (name === 'b' || name === 'strong') attributes.bold = true;
    if (name === 'i' || name === 'em') attributes.italic = true;
    if (name === 'u') attributes.underline = true;
    if (name === 's' || name === 'strike') attributes.strikethrough = true;
    if (node.dataset.hyperAtomic !== undefined) { append(atomicValue(node), attributes); return; }
    if (node.dataset.hyperEmbed) { append(JSON.parse(node.dataset.hyperEmbed), attributes); return; }
    if (name === 'br') { append('\n', attributes); return; }
    for (const child of node.childNodes) walk(child, attributes);
  }
  // Chromium leaves a single <br> in an empty editing host.
  if (element.childNodes.length === 1 && element.firstChild instanceof HTMLBRElement) return [];
  for (const child of element.childNodes) walk(child, {});
  return runs;
}
export function hyperWriteText(element: HTMLElement, runs: HyperTextRun[], options?: { blockType?: string; inlineMathLabels?: HyperInlineMathDomLabels }) {
  const fragment = document.createDocumentFragment();
  const budget = hyperInlineMathPaintBudget();
  let atomCount = 0;
  if (options?.blockType !== 'code') for (const run of runs) {
    const equation = hyperReadInlineMath(run);
    if (equation && !equation.atomic) { element.replaceChildren(hyperCreateInlineMathOverflow(runs, options?.inlineMathLabels, true)); return; }
    if (equation?.atomic) atomCount += (run.insert as string).length;
    if (atomCount > hyperInlineMathPaintLimits.atoms) { element.replaceChildren(hyperCreateInlineMathOverflow(runs, options?.inlineMathLabels)); return; }
  }
  for (const run of runs) {
    const mentionId = hyperPageMentionId(run), a = run.attributes ?? {};
    const equations = options?.blockType === 'code' ? [] : hyperCreateInlineMathElements(run, options?.inlineMathLabels, budget);
    if (equations.length) { for (const atom of equations) paintColors(atom, a); fragment.append(...equations); continue; }
    const footnotes = hyperCreateDocumentFootnoteElements(run);
    if (footnotes.length) { fragment.append(...footnotes); continue; }
    if (hyperDocumentDateMention(run)) {
      for (const insert of run.insert as string) fragment.append(hyperCreateDocumentDateElement({ insert, attributes: a }));
      continue;
    }
    if (mentionId) {
      for (const insert of run.insert as string) {
        const link = document.createElement('a');
        link.dataset.hyperAtomic = JSON.stringify(insert);
        link.dataset.hyperAttributes = JSON.stringify(a);
        link.dataset.hyperMentionId = mentionId;
        link.contentEditable = 'false'; link.href = '#'; link.tabIndex = 0;
        link.className = ['rounded-md bg-muted px-1 text-primary underline', a.bold && 'font-semibold', a.italic && 'italic', a.strikethrough && 'line-through', a.code && 'font-mono text-sm'].filter(Boolean).join(' ');
        paintColors(link, a);
        link.textContent = 'Page'; link.setAttribute('aria-label', 'Page');
        fragment.append(link);
      }
      continue;
    }
    const href = hyperSafeUrl(a.href);
    const span = document.createElement(typeof run.insert === 'string' && href ? 'a' : 'span');
    span.dataset.hyperAttributes = JSON.stringify(a);
    span.className = [a.bold && 'font-semibold', a.italic && 'italic', a.underline && 'underline', a.strikethrough && 'line-through', a.code && 'rounded-md bg-muted px-1 font-mono text-sm', hyperSafeUrl(a.href) && 'text-primary underline'].filter(Boolean).join(' ');
    paintColors(span, a);
    if (span instanceof HTMLAnchorElement && href) { span.href = href; span.tabIndex = 0; span.rel = 'noopener noreferrer'; bindLink(span, element, href); }
    if (typeof run.insert === 'string') span.textContent = run.insert;
    else {
      span.dataset.hyperAtomic = JSON.stringify(run.insert);
      span.dataset.hyperEmbed = JSON.stringify(run.insert);
      span.contentEditable = 'false';
      span.textContent = '\uFFFC';
      span.title = JSON.stringify(run.insert);
    }
    fragment.append(span);
  }
  element.replaceChildren(fragment);
}
function logicalLength(node: Node): number {
  if (node instanceof HTMLElement && node.dataset.hyperInlineMathLength !== undefined) { const length = Number(node.dataset.hyperInlineMathLength); if (Number.isSafeInteger(length) && length >= 0) return length; }
  if (atomic(node)) { const value = atomicValue(node); return typeof value === 'string' ? value.length : 1; }
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node instanceof HTMLBRElement) return 1;
  return Array.from(node.childNodes).reduce((length, child) => length + logicalLength(child), 0);
}
function beforeNode(root: HTMLElement, node: Node): number {
  let length = 0, current: Node | null = node;
  while (current && current !== root) {
    let sibling = current.previousSibling;
    while (sibling) { length += logicalLength(sibling); sibling = sibling.previousSibling; }
    current = current.parentNode;
  }
  return length;
}
function logicalPoint(root: HTMLElement, node: Node, offset: number, affinity: 'start' | 'end' | 'caret'): number {
  let ancestor: Node | null = node;
  while (ancestor && ancestor !== root && !atomic(ancestor)) ancestor = ancestor.parentNode;
  if (ancestor && ancestor !== root && atomic(ancestor)) {
    const inside = document.createRange(); inside.selectNodeContents(ancestor); inside.setEnd(node, offset);
    const visual = inside.toString().length, total = ancestor.textContent?.length ?? 0;
    const edge = visual === 0 ? 0 : visual >= total || affinity !== 'start' ? logicalLength(ancestor) : 0;
    return beforeNode(root, ancestor) + edge;
  }
  if (node.nodeType === Node.TEXT_NODE) return beforeNode(root, node) + Math.min(offset, node.textContent?.length ?? 0);
  return beforeNode(root, node) + Array.from(node.childNodes).slice(0, offset).reduce((length, child) => length + logicalLength(child), 0);
}
export function hyperGetSelection(element: HTMLElement): HyperTextSelection | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  if (element.childNodes.length === 1 && element.firstChild instanceof HTMLBRElement) return { start: 0, end: 0 };
  return {
    start: logicalPoint(element, range.startContainer, range.startOffset, range.collapsed ? 'caret' : 'start'),
    end: logicalPoint(element, range.endContainer, range.endOffset, range.collapsed ? 'caret' : 'end'),
  };
}
export function hyperSetSelection(element: HTMLElement, selection: HyperTextSelection) {
  const nodes: Node[] = [];
  const collect = (node: Node) => {
    if (atomic(node) || node.nodeType === Node.TEXT_NODE || node instanceof HTMLBRElement) nodes.push(node);
    else for (const child of node.childNodes) collect(child);
  };
  for (const child of element.childNodes) collect(child);
  const point = (offset: number): [Node, number] => {
    offset = Math.max(0, offset);
    for (const node of nodes) {
      const length = logicalLength(node);
      if (offset <= length) {
        if (node.nodeType === Node.TEXT_NODE) return [node, offset];
        const parent = node.parentNode!;
        return [parent, Array.prototype.indexOf.call(parent.childNodes, node) + (offset > 0 ? 1 : 0)];
      }
      offset -= length;
    }
    return [element, element.childNodes.length];
  };
  const range = document.createRange();
  range.setStart(...point(selection.start));
  range.setEnd(...point(selection.end));
  const current = window.getSelection();
  current?.removeAllRanges();
  current?.addRange(range);
}
