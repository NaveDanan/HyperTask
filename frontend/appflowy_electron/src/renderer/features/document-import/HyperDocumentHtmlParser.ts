import { hyperParseBookmarkHtmlMarker } from '../document-bookmark/HyperDocumentBookmarkValue';
import { hyperPortableBookmarkRaster, type HyperPortableBookmarkThumbnail } from '../document-bookmark/HyperBookmarkThumbnailValue';
import { hyperParseCodeLanguageMarker } from '../document-code/HyperDocumentCodeValue';
import { hyperParseFootnoteHtmlMarker, hyperReadDocumentFootnote } from '../document-footnote/HyperDocumentFootnoteValue';
import { HYPER_INLINE_MATH_MARKER, hyperParseInlineMathMarker } from '../document-inline-math/HyperInlineMathPortable';
import { HYPER_MARKDOWN_TEXT_MARKER, hyperParseMarkdownTextMarker } from '../document-format/HyperMarkdownStyledText';
import { create } from '@bufbuild/protobuf';
import { BlockPBSchema, ChildrenPBSchema, DocumentDataPBSchema, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import type { HyperTextRun } from '../document/HyperDocumentModel';
import { hyperDocumentColorAttribute, hyperDocumentColorCss } from '../document-format/HyperDocumentColor';

export interface HyperHtmlImportIssue { kind: 'active-content' | 'unsupported' | 'asset' | 'relative-link' | 'unsafe-link' | 'table-layout' | 'formatting'; tag: string; detail: string }
export interface HyperHtmlImportResult { title: string; document: DocumentDataPB; issues: HyperHtmlImportIssue[]; issueCount: number; blockCount: number; textLength: number; bookmarkThumbnails?: HyperPortableBookmarkThumbnail[] }
interface HyperHtmlBlock { type: string; data: Record<string, unknown>; runs?: HyperTextRun[]; children: HyperHtmlBlock[]; thumbnail?: Omit<HyperPortableBookmarkThumbnail, 'blockId'> }
const blocked = new Set(['script', 'style', 'link', 'meta', 'base', 'iframe', 'object', 'embed', 'audio', 'video', 'source', 'track', 'canvas', 'noscript']);
const containers = new Set(['div', 'article', 'main', 'section', 'header', 'footer', 'aside', 'figure', 'figcaption', 'body', 'html', 'form', 'dl', 'dt', 'dd']);
const blockTags = new Set([...containers, 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'blockquote', 'hr', 'table', 'details', 'summary']);
const inlineTags = new Set(['span', 'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'code', 'br', 'small', 'mark', 'font', 'label', 'abbr', 'time', 'sub', 'sup', 'kbd', 'samp']);
const tag = (element: Element) => element.localName.toLowerCase();
const compactText = (value: string) => value.replace(/[\t\r\n\f ]+/g, ' ').trim();

/** Parse only into template.content. Source nodes are never inserted into a live document. */
export function hyperParseHtmlImport(source: string, fallbackTitle = 'Imported page', ownerDocument: Document = document): HyperHtmlImportResult {
  if (source.length > 4_000_000) throw new Error('This HTML file is too large to import. Split it into smaller pages.');
  if (source.includes('\0')) throw new Error('This file contains binary data and cannot be imported as HTML.');
  const template = ownerDocument.createElement('template');
  template.innerHTML = source;
  const issues: HyperHtmlImportIssue[] = []; let issueCount = 0, visited = 0;
  const issue = (kind: HyperHtmlImportIssue['kind'], element: Element, detail: string) => {
    issueCount++; if (issues.length < 100) issues.push({ kind, tag: tag(element), detail: detail.slice(0, 500) });
  };
  const check = (depth: number) => { if (++visited > 50_000 || depth > 128) throw new Error('This HTML page is too complex to import safely. Split it into smaller pages.'); };
  let importedFootnotes = 0;
  const inspected = new WeakSet<Element>();
  const inspect = (element: Element) => {
    if (inspected.has(element)) return;
    inspected.add(element);
    if (Array.from(element.attributes).some(attribute => /^on/i.test(attribute.name))) issue('active-content', element, 'Event handlers were not imported.');
  };
  const inspectSourceBody = (element: Element, level: number) => {
    const nested = Array.from(element.childNodes, node => ({ node, level: level + 1 }));
    while (nested.length) {
      const child = nested.pop()!; check(child.level);
      if (child.node.nodeType === 1) inspect(child.node as Element);
      for (const node of child.node.childNodes) nested.push({ node, level: child.level + 1 });
    }
  };
  const notionTitle = template.content.querySelector('h1.page-title');
  const title = compactText(notionTitle?.textContent || template.content.querySelector('title')?.textContent || fallbackTitle).slice(0, 255) || 'Imported page';
  const textBlock = (type: string, runs: HyperTextRun[], data: Record<string, unknown> = {}, children: HyperHtmlBlock[] = []): HyperHtmlBlock => ({ type, runs, data, children });
  const isCheckbox = (element: Element) => tag(element) === 'input' && element.getAttribute('type')?.toLowerCase() === 'checkbox' || ['checkbox', 'checkbox-on', 'checkbox-off'].some(name => element.classList.contains(name));
  function inline(nodes: Node[], depth: number, preserve = false): HyperTextRun[] {
    const runs: HyperTextRun[] = [];
    const sourceRuns = new WeakSet<HyperTextRun>();
    const append = (value: string, attributes: Record<string, unknown>) => {
      let text = preserve ? value : value.replace(/[\t\r\n\f ]+/g, ' ');
      if (!preserve && (!runs.length || /[ \n]$/.test(String(runs.at(-1)?.insert)))) text = text.replace(/^ +/, '');
      if (!text) return;
      const last = runs.at(-1), styled = Object.keys(attributes).length ? { ...attributes } : undefined;
      if (last && !sourceRuns.has(last) && typeof last.insert === 'string' && JSON.stringify(last.attributes) === JSON.stringify(styled)) last.insert += text;
      else runs.push({ insert: text, ...(styled ? { attributes: styled } : {}) });
    };
    const walk = (node: Node, attributes: Record<string, unknown>, level: number, inLink = false) => {
      check(level);
      if (node.nodeType === 3) { append(node.textContent || '', attributes); return; }
      if (node.nodeType !== 1) return;
      const element = node as HTMLElement, name = tag(element);
      inspect(element);
      if (blocked.has(name)) { issue(name === 'style' ? 'formatting' : 'active-content', element, `${name} content was not imported.`); return; }
      if (!preserve && !attributes.code && !inLink && element.hasAttribute(HYPER_MARKDOWN_TEXT_MARKER)) {
        const run = name === 'span' ? hyperParseMarkdownTextMarker(element.getAttribute(HYPER_MARKDOWN_TEXT_MARKER)!) : null;
        if (!run) throw new Error('This formatted text has invalid or unsupported portable metadata. Its source file was kept.');
        inspectSourceBody(element, level);
        if (element.textContent !== run.insert) throw new Error('This formatted text has conflicting portable source text. Its source file was kept.');
        sourceRuns.add(run); runs.push(run); return;
      }
      if (!preserve && !attributes.code && !inLink && element.hasAttribute(HYPER_INLINE_MATH_MARKER)) {
        const atom = name === 'span' ? hyperParseInlineMathMarker(element.getAttribute(HYPER_INLINE_MATH_MARKER)!) : null;
        if (!atom) throw new Error('This inline equation has invalid or unsupported portable metadata. Its source file was kept.');
        inspectSourceBody(element, level);
        const annotations = element.querySelectorAll('annotation[encoding="application/x-tex"]');
        const source = annotations.length === 1 ? annotations[0].textContent : element.textContent;
        if (source !== atom.attributes!.formula) throw new Error('This inline equation has conflicting portable source text. Its source file was kept.');
        runs.push(atom); return;
      }
      if (!preserve && !attributes.code && element.hasAttribute('data-hyper-footnote')) {
        const atom = hyperParseFootnoteHtmlMarker(element.getAttribute('data-hyper-footnote')!);
        if (atom) { importedFootnotes++; runs.push(atom); return; }
        issue('unsupported', element, 'Invalid footnote metadata was kept as readable text.');
      }
      if (name === 'title' || element === notionTitle || isCheckbox(element)) return;
      if (!preserve && blockTags.has(name)) {
        issue('formatting', element, `Nested ${name} markup was retained as readable text.`);
        if (runs.length && !String(runs.at(-1)?.insert).endsWith('\n')) runs.push({ insert: '\n' });
        for (const child of element.childNodes) walk(child, attributes, level + 1, inLink);
        runs.push({ insert: '\n' }); return;
      }
      if (name === 'img') {
        if (element.hasAttribute('data-hyper-bookmark-thumbnail')) { append('[Bookmark thumbnail not imported]', attributes); issue('asset', element, 'A bookmark thumbnail reference was not imported. No address was loaded.'); return; }
        const reference = element.getAttribute('src') || '', label = element.getAttribute('alt') || 'Image';
        append(`[${label}]${reference ? ` (${reference})` : ''}`, attributes); issue('asset', element, `Image reference retained as text: ${reference || label}`); return;
      }
      if (name === 'svg' || name === 'math') { issue('unsupported', element, `${name} rendering is not supported; readable text was retained.`); }
      else if (!inlineTags.has(name) && !blockTags.has(name)) issue('unsupported', element, `${name} formatting was not imported; readable text was retained.`);
      const next = { ...attributes };
      if (['b', 'strong'].includes(name)) next.bold = true;
      if (['i', 'em'].includes(name)) next.italic = true;
      if (name === 'u') next.underline = true;
      if (['s', 'strike', 'del'].includes(name)) next.strikethrough = true;
      if (['code', 'kbd', 'samp'].includes(name) && !preserve) next.code = true;
      const style = element.style;
      if (style) {
        if (style.fontWeight === 'bold' || Number(style.fontWeight) >= 600) next.bold = true;
        if (style.fontWeight === 'normal') delete next.bold;
        if (style.fontStyle === 'italic') next.italic = true;
        if (style.fontStyle === 'normal') delete next.italic;
        if (style.textDecoration.includes('underline')) next.underline = true;
        if (style.textDecoration.includes('line-through')) next.strikethrough = true;
        for (const [value, key] of [[style.color || element.getAttribute('color'), 'font_color'], [style.backgroundColor, 'bg_color']] as const) {
          const color = hyperDocumentColorCss(value);
          if (color) next[key] = hyperDocumentColorAttribute(color);
          else if (value) issue('formatting', element, 'An unsupported text color was not imported.');
        }
      }
      if (name === 'a') {
        const href = element.getAttribute('href') || '';
        try {
          const url = new URL(href);
          if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsafe link');
          next.href = href;
        } catch {
          issue(/^[A-Za-z][A-Za-z\d+.-]*:/.test(href) ? 'unsafe-link' : 'relative-link', element, `Link text retained without navigation: ${href}`);
        }
      }
      if (name === 'br') { runs.push({ insert: '\n', ...(Object.keys(next).length ? { attributes: next } : {}) }); return; }
      if (name === 'input' || name === 'button' || name === 'select' || name === 'textarea') { issue('unsupported', element, 'Form controls were not imported.'); return; }
      if (['sub', 'sup'].includes(name)) issue('formatting', element, `${name} text was retained without vertical positioning.`);
      for (const child of element.childNodes) walk(child, next, level + 1, inLink || name === 'a');
    };
    nodes.forEach(node => walk(node, {}, depth));
    if (!preserve && runs.length) { const last = runs.at(-1)!; if (!sourceRuns.has(last) && typeof last.insert === 'string' && !hyperReadDocumentFootnote(last)?.atomic) last.insert = last.insert.replace(/ +$/, ''); if (!last.insert) runs.pop(); }
    return runs;
  }
  function blocks(nodes: Node[], depth: number): HyperHtmlBlock[] {
    const result: HyperHtmlBlock[] = [], pending: Node[] = [];
    const flush = () => { if (pending.length) { const runs = inline(pending.splice(0), depth + 1); if (runs.length) result.push(textBlock('paragraph', runs)); } };
    for (const node of nodes) {
      check(depth);
      if (node.nodeType !== 1 || !blockTags.has(tag(node as Element))) { pending.push(node); continue; }
      flush(); result.push(...block(node as HTMLElement, depth + 1));
    }
    flush(); return result;
  }
  function list(element: HTMLElement, depth: number): HyperHtmlBlock[] {
    const result: HyperHtmlBlock[] = [];
    if (tag(element) === 'ol' && Number(element.getAttribute('start') || 1) !== 1) issue('formatting', element, 'Numbered list start values are not displayed by this editor.');
    for (const child of element.children) {
      if (tag(child) !== 'li') { result.push(...blocks([child], depth + 1)); continue; }
      const checkbox = Array.from(child.querySelectorAll('input[type="checkbox"],.checkbox,.checkbox-on,.checkbox-off')).find(marker => marker.closest('li') === child);
      const task = !!checkbox || element.classList.contains('to-do-list');
      const content = blocks(Array.from(child.childNodes), depth + 1), first = content[0]?.type === 'paragraph' ? content.shift()! : null;
      result.push(textBlock(task ? 'todo_list' : tag(element) === 'ol' ? 'numbered_list' : 'bulleted_list', first?.runs ?? [], task ? { checked: !!checkbox && (checkbox.hasAttribute('checked') || checkbox.classList.contains('checkbox-on')) } : {}, [...(first?.children ?? []), ...content]));
    }
    return result;
  }
  function table(element: HTMLElement, depth: number): HyperHtmlBlock[] {
    const rows = Array.from(element.querySelectorAll('tr')).filter(row => row.closest('table') === element);
    if (rows.length > 100) throw new Error('An imported table has more than 100 rows. Split the table before importing.');
    const cells = rows.map(row => Array.from(row.children).filter(cell => ['th', 'td'].includes(tag(cell))));
    const width = Math.max(0, ...cells.map(row => row.length));
    if (width > 100) throw new Error('An imported table has more than 100 columns. Split the table before importing.');
    const caption = element.querySelector(':scope > caption');
    const result = caption ? [textBlock('paragraph', inline(Array.from(caption.childNodes), depth + 1))] : [];
    if (!width) { issue('table-layout', element, 'An empty table had no cells to import.'); return result; }
    if (cells.some(row => row.some(cell => Number(cell.getAttribute('rowspan') || 1) !== 1 || Number(cell.getAttribute('colspan') || 1) !== 1))) {
      issue('table-layout', element, 'Merged table cells were retained as text rows.');
      for (const row of cells) result.push(textBlock('paragraph', row.flatMap((cell, index) => [...(index ? [{ insert: '\t' }] : []), ...inline(Array.from(cell.childNodes), depth + 1)])));
      return result;
    }
    if (cells.some(row => row.length !== width)) issue('table-layout', element, 'Short table rows were padded with empty cells.');
    if (element.classList.contains('collection-content') || element.closest('.collection')) issue('unsupported', element, 'This Notion database was imported as a static table; database properties and views were not imported.');
    const tableBlock: HyperHtmlBlock = { type: 'simple_table', data: { enable_header_row: cells[0]?.every(cell => tag(cell) === 'th') ?? false, enable_header_column: cells.every(row => row[0] && tag(row[0]) === 'th'), distribute_column_widths_evenly: true }, children: cells.map(row => ({ type: 'simple_table_row', data: {}, children: Array.from({ length: width }, (_, index) => ({ type: 'simple_table_cell', data: {}, children: row[index] ? blocks(Array.from(row[index].childNodes), depth + 1) : [textBlock('paragraph', [])] })) })) };
    for (const row of tableBlock.children) for (const cell of row.children) if (!cell.children.length) cell.children.push(textBlock('paragraph', []));
    result.push(tableBlock); return result;
  }
  function block(element: HTMLElement, depth: number): HyperHtmlBlock[] {
    check(depth); const name = tag(element);
    inspect(element);
    if (element === notionTitle) return [];
    if (element.hasAttribute('data-hyper-bookmark')) {
      const card = hyperParseBookmarkHtmlMarker(element.getAttribute('data-hyper-bookmark')!);
      if (card) {
        const images = element.querySelectorAll('img[data-hyper-bookmark-thumbnail]'); let thumbnail: HyperHtmlBlock['thumbnail'];
        if (images.length === 1) { const image = images[0], dataUrl = image.getAttribute('src') ?? '', width = Number(image.getAttribute('width')), height = Number(image.getAttribute('height')); if (hyperPortableBookmarkRaster(dataUrl) && Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 4096 && height <= 4096 && width * height <= 4_194_304) thumbnail = { dataUrl, width, height }; else issue('asset', image, 'The bookmark thumbnail was not a supported embedded raster snapshot. Its address was not loaded.'); }
        else if (images.length) issue('asset', element, 'Multiple bookmark thumbnails were not imported.');
        return [{ type: card.type, data: card.data, children: [], ...(thumbnail ? { thumbnail } : {}) }];
      }
      issue('unsupported', element, 'Invalid link card metadata was retained as readable content.');
    }
    if (importedFootnotes && name === 'section' && element.getAttribute('data-hyper-footnote-definitions') === '1') return [];
    if (/^h[1-6]$/.test(name)) return [textBlock('heading', inline(Array.from(element.childNodes), depth + 1), { level: Number(name[1]) })];
    if (name === 'p' || name === 'summary') return [textBlock('paragraph', inline(Array.from(element.childNodes), depth + 1))];
    if (name === 'hr') return [{ type: 'divider', data: {}, children: [] }];
    if (name === 'ul' || name === 'ol') return list(element, depth + 1);
    if (name === 'pre') {
      const language = (element.querySelector('code')?.className || element.className).match(/(?:language-|lang-)([\w+-]+)/)?.[1] || '';
      const marker = element.getAttribute('data-hyper-code-language'), parsed = marker === null ? null : hyperParseCodeLanguageMarker(marker);
      if (marker !== null && !parsed) issue('unsupported', element, 'The code language metadata was unsupported. Readable code and its conventional language tag were retained.');
      return [textBlock('code', inline(Array.from(element.childNodes), depth + 1, true), parsed ?? { language })];
    }
    if (name === 'table') return table(element, depth + 1);
    if (name === 'details') {
      const summary = Array.from(element.children).find(child => tag(child) === 'summary');
      return [textBlock('toggle_list', summary ? inline(Array.from(summary.childNodes), depth + 1) : [], {}, blocks(Array.from(element.childNodes).filter(child => child !== summary), depth + 1))];
    }
    if (name === 'blockquote' || name === 'aside' || element.classList.contains('callout')) {
      const content = blocks(Array.from(element.childNodes), depth + 1), first = content[0]?.type === 'paragraph' ? content.shift()! : null;
      return [textBlock(name === 'blockquote' ? 'quote' : 'callout', first?.runs ?? [], {}, [...(first?.children ?? []), ...content])];
    }
    if (['dl', 'dt', 'dd', 'form'].includes(name)) issue('formatting', element, `${name} structure was flattened into readable blocks.`);
    return blocks(Array.from(element.childNodes), depth + 1);
  }
  const content = blocks(Array.from(template.content.childNodes), 0);
  if (!content.length) content.push(textBlock('paragraph', []));
  const documentData = create(DocumentDataPBSchema, { pageId: crypto.randomUUID(), meta: {} });
  let blockCount = 0, textLength = 0; const bookmarkThumbnails: HyperPortableBookmarkThumbnail[] = [];
  const write = (sourceBlock: HyperHtmlBlock, parentId: string, id: string = crypto.randomUUID()): string => {
    if (++blockCount > 10_000) throw new Error('This page contains too many blocks to import. Split it into smaller pages.');
    const childrenId = crypto.randomUUID(), data = { ...sourceBlock.data };
    const textId = sourceBlock.runs ? crypto.randomUUID() : undefined;
    const blockData = create(BlockPBSchema, { id, parentId, ty: sourceBlock.type, childrenId, data: JSON.stringify(data), ...(textId ? { oneOfExternalId: { case: 'externalId', value: textId }, oneOfExternalType: { case: 'externalType', value: 'text' } } : {}) });
    documentData.blocks[id] = blockData;
    if (sourceBlock.thumbnail) bookmarkThumbnails.push({ blockId: id, ...sourceBlock.thumbnail });
    if (textId) {
      textLength += sourceBlock.runs!.reduce((total, run) => total + (typeof run.insert === 'string' ? run.insert.length : 1), 0);
      if (textLength > 2_000_000) throw new Error('This page has too much text to import. Split it into smaller pages.');
      documentData.meta!.textMap[textId] = JSON.stringify(sourceBlock.runs);
    }
    documentData.meta!.childrenMap[childrenId] = create(ChildrenPBSchema, { children: sourceBlock.children.map(child => write(child, id)) });
    return id;
  };
  write({ type: 'page', data: {}, children: content }, '', documentData.pageId);
  return { title, document: documentData, issues, issueCount, blockCount, textLength, ...(bookmarkThumbnails.length ? { bookmarkThumbnails } : {}) };
}
