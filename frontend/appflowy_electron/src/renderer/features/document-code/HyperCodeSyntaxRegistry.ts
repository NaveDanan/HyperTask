import { hyperCodeSyntaxBoundary, hyperCodeSyntaxLimits, type HyperCodeSyntaxKind, type HyperCodeSyntaxRange } from './HyperCodeSyntaxTypes';
type HighlightSet = { add(range: Range): unknown; delete(range: Range): boolean; size: number };
interface HighlightDocument { defaultView: (Window & { Highlight?: new (...ranges: Range[]) => HighlightSet; CSS?: { highlights?: Map<string, HighlightSet> } }) | null }
interface Registry { groups: Map<HyperCodeSyntaxKind, HighlightSet>; leases: Map<object, Range[]>; total: number }
const registries = new WeakMap<Document, Registry>();
const names: HyperCodeSyntaxKind[] = ['keyword', 'string', 'number', 'comment', 'title'];
export function hyperCodeSyntaxAvailable(document: Document) { const view = (document as unknown as HighlightDocument).defaultView; return typeof view?.Highlight === 'function' && !!view.CSS?.highlights; }
function registry(document: Document) { let value = registries.get(document); if (!value) { value = { groups: new Map(), leases: new Map(), total: 0 }; registries.set(document, value); } return value; }
export function hyperClearCodeSyntax(document: Document, lease: object) {
  const value = registries.get(document); if (!value) return;
  const ranges = value.leases.get(lease); if (!ranges) return;
  for (const range of ranges) for (const group of value.groups.values()) group.delete(range);
  value.total -= ranges.length; value.leases.delete(lease);
  const highlights = (document as unknown as HighlightDocument).defaultView?.CSS?.highlights;
  for (const [kind, group] of value.groups) if (!group.size) { if (highlights?.get(`hyper-code-${kind}`) === group) highlights.delete(`hyper-code-${kind}`); value.groups.delete(kind); }
}
/** Registered ranges never insert spans, change text nodes, selection or persisted marks. */
export function hyperPaintCodeSyntax(element: HTMLElement, lease: object, source: string, tokens: HyperCodeSyntaxRange[]): boolean {
  const document = element.ownerDocument; hyperClearCodeSyntax(document, lease);
  if (!hyperCodeSyntaxAvailable(document) || element.textContent !== source || !element.isConnected || tokens.length > hyperCodeSyntaxLimits.ranges) return false;
  const value = registry(document); if (value.total + tokens.length > hyperCodeSyntaxLimits.totalRanges) return false;
  const registered = (document as unknown as HighlightDocument).defaultView!.CSS!.highlights!;
  for (const token of tokens) { const existing = registered.get(`hyper-code-${token.kind}`); if (existing && existing !== value.groups.get(token.kind)) return false; }
  const walker = document.createTreeWalker(element, 4), nodes: Array<{ node: Node; start: number; end: number }> = []; let node: Node | null, offset = 0;
  while ((node = walker.nextNode())) { const end = offset + (node.textContent?.length ?? 0); nodes.push({ node, start: offset, end }); offset = end; if (nodes.length > hyperCodeSyntaxLimits.ranges) return false; }
  if (offset !== source.length) return false;
  const prepared: Array<{ kind: HyperCodeSyntaxKind; range: Range }> = []; let previous = 0, at = 0;
  for (const token of tokens) {
    if (!names.includes(token.kind) || !hyperCodeSyntaxBoundary(source, token.start) || !hyperCodeSyntaxBoundary(source, token.end) || token.start < previous || token.end <= token.start) return false;
    previous = token.end;
    while (at < nodes.length && nodes[at].end <= token.start) at++;
    const start = nodes[at]; let last = at; while (last < nodes.length && nodes[last].end < token.end) last++;
    const end = nodes[last]; if (!start || !end) return false;
    const range = document.createRange(); range.setStart(start.node, token.start - start.start); range.setEnd(end.node, token.end - end.start); prepared.push({ kind: token.kind, range });
  }
  const view = (document as unknown as HighlightDocument).defaultView!;
  try {
    for (const item of prepared) { let group = value.groups.get(item.kind); if (!group) { group = new view.Highlight!(); value.groups.set(item.kind, group); } if (view.CSS!.highlights!.get(`hyper-code-${item.kind}`) !== group) view.CSS!.highlights!.set(`hyper-code-${item.kind}`, group); group.add(item.range); }
    value.leases.set(lease, prepared.map(item => item.range)); value.total += prepared.length; return true;
  } catch { value.leases.set(lease, prepared.map(item => item.range)); value.total += prepared.length; hyperClearCodeSyntax(document, lease); return false; }
}
