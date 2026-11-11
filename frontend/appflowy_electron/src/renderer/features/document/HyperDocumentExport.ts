import { hyperExportDocumentBookmark } from '../document-bookmark/HyperDocumentBookmarkExport';
import { hyperBookmarkTypes, hyperReadBookmarkValue } from '../document-bookmark/HyperDocumentBookmarkValue';
import { hyperCodeHtmlLanguage, hyperCodeLanguageMarker, hyperCodeMarkdownLanguage } from '../document-code/HyperDocumentCodeValue';
import { hyperCloudAssetIsProtected } from '../cloud-assets/HyperCloudAssetPreview';
import type { BlockPB, DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockData, hyperBlockText, hyperChildren, hyperPlainText, hyperTextTypes, type HyperTextRun } from './HyperDocumentModel';
import { hyperExportWhiteboardSVG, type HyperWhiteboardExportOptions } from '../whiteboard/HyperWhiteboardExport';
import { hyperReadDocumentColumns } from '../document-columns/HyperDocumentColumnsModel';
import { hyperDocumentColorCss } from '../document-format/HyperDocumentColor';
import type { UserDateFormatPB, UserTimeFormatPB } from '@shared/protobuf/flowy-user/date_time_pb';
import { hyperDocumentDateLabel, hyperDocumentDateMention } from '../document-date/HyperDocumentDateValue';
import { hyperRenderEquationMathML } from '../document-equation/HyperDocumentEquationMathML';
import { hyperCreateFootnoteExport, type HyperFootnoteExport } from '../document-footnote/HyperDocumentFootnoteExport';
import { hyperReadDocumentFootnote } from '../document-footnote/HyperDocumentFootnoteValue';
import { hyperExportInlineMath, type HyperInlineMathExportBudget } from '../document-inline-math/HyperInlineMathExport';
import { hyperReadInlineMath } from '../document-inline-math/HyperInlineMathValue';
import { hyperExportMarkdownStyledText, hyperMarkdownStyledTextRequired, type HyperMarkdownTextBudget } from '../document-format/HyperMarkdownStyledText';
import { HYPER_MATH_FONT_FAMILY_CSS, HYPER_MATH_FONT_MARKER, hyperMathFontCss } from '@shared/HyperMathFont';

export interface HyperDocumentExportOptions {
  canvas?: HyperWhiteboardExportOptions;
  /** Encoded sibling SVG filename for Markdown file exports. Clipboard exports inline SVG. */
  canvasUrl?: string;
  /** Managed attachment path or protocol URL mapped to a sibling filename or safe data URL. */
  mediaUrls?: Record<string, string>;
  pageMentions?: Record<string, { label: string; url?: string }>;
  dateFormat?: UserDateFormatPB;
  timeFormat?: UserTimeFormatPB;
}

function pageMention(run: HyperTextRun): string | null {
  const mention = run.attributes?.mention;
  return typeof run.insert === 'string' && /^\$+$/.test(run.insert) && mention && typeof mention === 'object' && 'type' in mention && mention.type === 'page' && 'page_id' in mention && typeof mention.page_id === 'string' && mention.page_id ? mention.page_id : null;
}

const localAsset = (value: string) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('appflowy-file:');
/** Only reachable document attachments are packaged; detached blocks remain untouched. */
function exportReferences(doc: DocumentDataPB) {
  const assets = new Set<string>(), thumbnails = new Set<string>(), pages = new Set<string>(), visited = new Set<string>(), stack = [doc.pageId];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) throw new Error('Document contains a cycle or repeated block');
    visited.add(id);
    const block = doc.blocks[id];
    if (!block) throw new Error(`Document contains a missing block: ${id}`);
    if (block.ty === 'hyper_canvas') continue;
    if (block.ty === 'image' || block.ty === 'file') {
      const url = hyperBlockData(block).url;
      if (typeof url === 'string' && localAsset(url)) assets.add(url);
    }
    if (hyperBookmarkTypes.has(block.ty)) { const thumbnail = hyperReadBookmarkValue(block).fields.thumbnail; if (thumbnail?.media.source === 'local') { assets.add(thumbnail.media.url); thumbnails.add(thumbnail.media.url); } }
    if (hyperTextTypes.has(block.ty)) for (const run of hyperBlockText(doc, block)) {
      const id = pageMention(run); if (id) pages.add(id);
      const footnote = hyperReadDocumentFootnote(run);
      if (footnote?.value?.kind === 'citation' && footnote.value.data.reference.type === 'doc' && footnote.value.data.reference.docId) pages.add(footnote.value.data.reference.docId);
    }
    stack.push(...hyperChildren(doc, block).toReversed());
  }
  return { assets: [...assets], thumbnails: [...thumbnails], pages: [...pages] };
}
export const hyperDocumentLocalAssets = (doc: DocumentDataPB) => exportReferences(doc).assets;
export const hyperDocumentLocalBookmarkThumbnails = (doc: DocumentDataPB) => exportReferences(doc).thumbnails;
export const hyperDocumentPageMentions = (doc: DocumentDataPB) => exportReferences(doc).pages;
function exportedAsset(value: string): string {
  if (/^data:(?:image\/(?:png|jpeg|gif|webp|svg\+xml|avif|bmp|x-icon)|application\/octet-stream);base64,[A-Za-z0-9+/]*={0,2}$/.test(value)) return value;
  if (/^[A-Za-z0-9%_.-]+$/.test(value)) {
    const decoded = decodeURIComponent(value);
    if (decoded !== '.' && decoded !== '..' && !/[/\\\0]/.test(decoded)) return value;
  }
  throw new Error('Attachment export requires a safe data URL or encoded sibling filename');
}

export const hyperDocumentHasCanvas = (doc: DocumentDataPB) => {
  const root = doc.blocks[doc.pageId];
  return !!root && hyperChildren(doc, root).some(id => doc.blocks[id]?.ty === 'hyper_canvas');
};

export const hyperEscapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function hyperSafeUrl(value: unknown, media = false): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return (media ? ['https:', 'http:', 'appflowy-file:'] : ['https:', 'http:', 'mailto:', 'appflowy-flutter:']).includes(url.protocol) ? value : null;
  } catch { return null; }
}
const escapeMarkdown = (text: string) => text.replace(/([\\`*_[\]<>!#()+.\-~])/g, '\\$1');
function inline(runs: HyperTextRun[], html: boolean, options: HyperDocumentExportOptions, footnotes: () => HyperFootnoteExport, equation: () => void, budget: HyperInlineMathExportBudget, styledBudget: HyperMarkdownTextBudget | undefined): string {
  return runs.map((run, index) => {
    const math = hyperExportInlineMath(run, html, budget);
    if (math !== null) { if (html) equation(); return math; }
    const footnote = hyperReadDocumentFootnote(run) ? footnotes().inline(run, html) : null;
    if (footnote !== null) return footnote;
    if (typeof run.insert !== 'string') {
      // Keep mention labels readable. Preserve all original data in the document.
      return html ? hyperEscapeHtml(JSON.stringify(run.insert)) : escapeMarkdown(JSON.stringify(run.insert));
    }
    const a = run.attributes ?? {};
    const target = pageMention(run), page = target ? options.pageMentions?.[target] : undefined;
    const date = hyperDocumentDateMention(run);
    if (!html && styledBudget && !target && !date && hyperMarkdownStyledTextRequired(run, runs[index - 1], runs[index + 1])) return hyperExportMarkdownStyledText(run, styledBudget);
    const literal = target ? Array.from(run.insert, () => page?.label || target).join('') : date ? Array.from(run.insert, () => hyperDocumentDateLabel(date, options.dateFormat, options.timeFormat)).join('') : run.insert;
    let text = html ? hyperEscapeHtml(literal).replaceAll('\n', '<br>') : escapeMarkdown(literal);
    if (a.code) text = html ? `<code>${text}</code>` : `${'`'.repeat(Math.max(1, ...Array.from(literal.matchAll(/`+/g), m => m[0].length + 1)))} ${literal} ${'`'.repeat(Math.max(1, ...Array.from(literal.matchAll(/`+/g), m => m[0].length + 1)))}`;
    if (a.bold) text = html ? `<strong>${text}</strong>` : `**${text}**`;
    if (a.italic) text = html ? `<em>${text}</em>` : `*${text}*`;
    if (a.strikethrough) text = html ? `<s>${text}</s>` : `~~${text}~~`;
    if (a.underline && html) text = `<u>${text}</u>`;
    if (html) {
      const foreground = hyperDocumentColorCss(a.font_color), background = hyperDocumentColorCss(a.bg_color);
      if (foreground || background) text = `<span style="${[foreground && `color:${foreground}`, background && `background-color:${background}`].filter(Boolean).join(';')}">${text}</span>`;
    }
    const href = hyperSafeUrl(target ? page?.url : a.href);
    if (href) text = html ? `<a href="${hyperEscapeHtml(href)}" rel="noopener noreferrer">${text}</a>` : `[${text}](<${href.replaceAll('>', '%3E').replaceAll('<', '%3C').replaceAll('\n', '')}>)`;
    if (target) text = html ? `<span data-hyper-page-id="${hyperEscapeHtml(target)}">${text}</span>` : href || !page?.label || page.label === target ? text : `${text} \\[page: ${escapeMarkdown(target)}\\]`;
    if (date && html) text = `<time datetime="${hyperEscapeHtml(date.date)}">${text}</time>`;
    return text;
  }).join('');
}

export function hyperExportDocument(doc: DocumentDataPB, format: 'markdown' | 'html', title = '', options: HyperDocumentExportOptions = {}): string {
  const html = format === 'html';
  let footnoteExport: HyperFootnoteExport | undefined;
  const footnotes = () => footnoteExport ??= hyperCreateFootnoteExport(doc, options.pageMentions);
  let equations = false, protectedImageSize = 0;
  const inlineBudget: HyperInlineMathExportBudget = { atoms: 0, bytes: 0 };
  const styledBudget: HyperMarkdownTextBudget = { runs: 0, bytes: 0 };
  const visited = new Set<string>();
  let canvasExported = false;
  const walk = (id: string, depth: number): string => {
    if (visited.has(id)) throw new Error('Document contains a cycle or repeated block');
    visited.add(id);
    const block: BlockPB | undefined = doc.blocks[id];
    if (!block) throw new Error(`Document contains a missing block: ${id}`);
    const data = hyperBlockData(block), runs = hyperBlockText(doc, block);
    if (block.ty === 'code' && runs.some(run => hyperReadInlineMath(run))) throw new Error('Inline equations inside code use an unsupported format. Copy their source before exporting.');
    const text = inline(runs, html, options, footnotes, () => { equations = true; }, inlineBudget, block.ty === 'code' ? undefined : styledBudget), plain = hyperPlainText(runs.map(run => {
      const id = pageMention(run), page = id ? options.pageMentions?.[id] : undefined;
      return id ? { insert: page?.label && page.label !== id ? `${page.label} [page: ${id}]` : id } : run;
    }));
    if (block.ty === 'hyper_canvas') {
      if (block.parentId !== doc.pageId) throw new Error('A canvas container must be a document root child');
      if (canvasExported) return '';
      canvasExported = true;
      // A document can contain multiple compatible canvas containers. The exporter renders
      // their elements together once, matching canvas mode, and rejects unknown elements.
      const canvasNodes = new Set<string>();
      for (const containerId of hyperChildren(doc, doc.blocks[doc.pageId])) {
        const container = doc.blocks[containerId];
        if (container?.ty !== 'hyper_canvas') continue;
        for (const elementId of hyperChildren(doc, container)) {
          const element = doc.blocks[elementId];
          if (canvasNodes.has(elementId) || !element || element.parentId !== container.id || hyperChildren(doc, element).length) throw new Error('Canvas contains invalid or unsupported nested blocks');
          canvasNodes.add(elementId);
        }
      }
      const svg = hyperExportWhiteboardSVG(doc, { title, ...options.canvas });
      if (html || !options.canvasUrl) return svg;
      if (!/^[A-Za-z0-9%_.-]+\.svg$/i.test(options.canvasUrl)) throw new Error('Canvas export requires an encoded sibling SVG filename');
      return `![${escapeMarkdown(title || 'Canvas')}](<${options.canvasUrl}>)`;
    }
    if (block.ty === 'simple_table' && !html) {
      const rows = hyperChildren(doc, block).map(rowId => {
        if (visited.has(rowId) || doc.blocks[rowId]?.ty !== 'simple_table_row') throw new Error('Invalid table row');
        visited.add(rowId);
        return hyperChildren(doc, doc.blocks[rowId]).map(cellId => {
          if (doc.blocks[cellId]?.ty !== 'simple_table_cell') throw new Error('Invalid table cell');
          return walk(cellId, 0).trim().replaceAll('|', '\\|').replace(/\n+/g, '<br>');
        });
      });
      if (!rows.length) return '';
      const width = rows[0].length;
      if (!width || rows.some(row => row.length !== width)) throw new Error('Cannot export an irregular table');
      const header = data.enable_header_row === true ? rows.shift()! : Array<string>(width).fill('');
      const line = (row: string[]) => `| ${row.join(' | ')} |`;
      return [line(header), line(Array<string>(width).fill('---')), ...rows.map(line)].join('\n');
    }
    const childIds = hyperChildren(doc, block);
    const childDepth = block.ty === 'quote' || block.ty === 'callout' ? 0 : depth + (block.ty === 'page' ? 0 : block.ty === 'numbered_list' ? 3 : 2);
    const rendered = childIds.map(child => walk(child, childDepth));
    let children = rendered.join(html ? '\n' : '\n\n');
    if (html) {
      const listTag = (id: string) => doc.blocks[id]?.ty === 'numbered_list' ? 'ol' : ['bulleted_list', 'todo_list'].includes(doc.blocks[id]?.ty) ? 'ul' : null;
      children = rendered.map((content, index) => {
        const tag = listTag(childIds[index]);
        if (!tag) return content;
        return `${index === 0 || listTag(childIds[index - 1]) !== tag ? `<${tag}>` : ''}${content}${index === childIds.length - 1 || listTag(childIds[index + 1]) !== tag ? `</${tag}>` : ''}`;
      }).join('\n');
    }
    const level = Math.max(1, Math.min(6, Number(data.level) || 1));
    let body: string;
    switch (block.ty) {
      case 'page': return children;
      case 'math_equation': {
        if (typeof data.formula !== 'string' || hyperChildren(doc, block).length || block.oneOfExternalId.case === 'externalId' && block.oneOfExternalId.value || block.oneOfExternalType.case === 'externalType' && block.oneOfExternalType.value) throw new Error('This equation has an unsupported format. Its source was kept.');
        if (html) { equations = true; body = `<div class="hyper-document-equation" data-hyper-equation="mathml">${hyperRenderEquationMathML(data.formula)}</div>`; }
        else { if (/^\s*\$\$\s*$/mu.test(data.formula)) throw new Error('This equation contains a Markdown delimiter line. Its source was kept; use HTML or copy the formula directly.'); body = `$$\n${data.formula}\n$$`; }
        break;
      }
      case 'simple_table': return `<table><tbody>${children}</tbody></table>`;
      case 'simple_table_row': return html ? `<tr>${children}</tr>` : children;
      case 'simple_table_cell': {
        if (!html) return children;
        const row = doc.blocks[block.parentId], table = row && doc.blocks[row.parentId];
        const settings = table ? hyperBlockData(table) : {};
        const headerRow = table && settings.enable_header_row === true && hyperChildren(doc, table)[0] === row.id;
        const header = headerRow || (row && settings.enable_header_column === true && hyperChildren(doc, row)[0] === id);
        return header ? `<th scope="${headerRow ? 'col' : 'row'}">${children}</th>` : `<td>${children}</td>`;
      }
      case 'simple_columns': {
        if (!html) return children;
        const layout = hyperReadDocumentColumns(doc, id);
        if (!layout.supported) throw new Error(layout.error!);
        return `<div data-hyper-columns="true" style="display:flex;align-items:flex-start;gap:16px">${children}</div>`;
      }
      case 'simple_column': {
        if (!html) return children;
        const layout = hyperReadDocumentColumns(doc, block.parentId), column = layout.columns.find(column => column.id === id);
        if (!layout.supported || !column) throw new Error(layout.error ?? 'This column is no longer attached to its layout.');
        return `<div data-hyper-column="true" style="flex:${column.ratio} 1 0%;min-width:0">${children}</div>`;
      }
      case 'heading': body = html ? `<h${level}>${text}</h${level}>` : `${'#'.repeat(level)} ${text}`; break;
      case 'bulleted_list': body = html ? `<li>${text}${children}</li>` : `- ${text}`; break;
      case 'numbered_list': body = html ? `<li>${text}${children}</li>` : `1. ${text}`; break;
      case 'todo_list': body = html ? `<li><input type="checkbox" disabled${data.checked ? ' checked' : ''}> ${text}${children}</li>` : `- [${data.checked ? 'x' : ' '}] ${text}`; break;
      case 'toggle_list': body = html ? `<details><summary>${text}</summary>${children}</details>` : `- ${text}`; break;
      case 'quote': case 'callout': body = html ? `<blockquote>${text}${children ? `\n${children}` : ''}</blockquote>` : `${text.split('\n').map(line => `> ${line}`).join('\n')}${children ? `\n>\n${children.split('\n').map(line => `> ${line}`).join('\n')}` : ''}`; break;
      case 'divider': body = html ? '<hr>' : '---'; break;
      case 'code': {
        const fence = '`'.repeat(Math.max(3, ...Array.from(plain.matchAll(/`+/g), m => m[0].length + 1)));
        const language = html ? hyperCodeHtmlLanguage(block) : null;
        body = html ? `<pre data-hyper-code-language="${hyperEscapeHtml(hyperCodeLanguageMarker(block))}"><code${language ? ` class="language-${language}"` : ''}>${hyperEscapeHtml(plain)}</code></pre>` : `${fence}${hyperCodeMarkdownLanguage(block)}\n${plain}\n${fence}`; break;
      }
      case 'link_preview': case 'link_embed': case 'video': body = hyperExportDocumentBookmark(doc, id, html, options.mediaUrls); break;
      case 'image': case 'file': {
        const local = (block.ty === 'image' || block.ty === 'file') && typeof data.url === 'string' && localAsset(data.url);
        const imageUrl = block.ty === 'image' && !local && typeof data.url === 'string' && hyperSafeUrl(data.url, true) ? new URL(data.url) : null;
        if (imageUrl && (imageUrl.username || imageUrl.password)) throw new Error('Image export does not support addresses with embedded credentials.');
        const protectedImage = !!imageUrl && hyperCloudAssetIsProtected(imageUrl.href);
        const mapped = local || protectedImage ? options.mediaUrls?.[String(data.url)] : undefined;
        if (protectedImage && !mapped) throw new Error('Protected images must be included in the export.');
        if (protectedImage && mapped) { protectedImageSize += mapped.length; if (protectedImageSize > 48 * 1024 * 1024) throw new Error('The images are too large for a portable export. Export fewer images.'); }
        if (local && !mapped) throw new Error('Local attachments must be included in the export.');
        const url = mapped ? exportedAsset(mapped) : hyperSafeUrl(data.url, block.ty === 'image' || block.ty === 'file');
        const label = String(data.name ?? data.caption ?? (local ? String(data.url).split(/[\\/]/).at(-1) : protectedImage ? 'image' : data.url) ?? block.ty);
        if (!url) body = html ? `<p>${hyperEscapeHtml(label)}</p>` : escapeMarkdown(label);
        else if (block.ty === 'image') {
          const alt = typeof data.alt === 'string' ? data.alt : label;
          const caption = typeof data.caption === 'string' ? data.caption : '';
          body = html ? `${caption ? '<figure>' : ''}<img src="${hyperEscapeHtml(url)}" alt="${hyperEscapeHtml(alt)}">${caption ? `<figcaption>${hyperEscapeHtml(caption)}</figcaption></figure>` : ''}` : `![${escapeMarkdown(alt)}](<${url.replaceAll('>', '%3E')}>)${caption ? `\n\n${escapeMarkdown(caption)}` : ''}`;
        }
        else body = html ? `<p><a href="${hyperEscapeHtml(url)}"${local ? ` download="${hyperEscapeHtml(label)}"` : ''}>${hyperEscapeHtml(label)}</a></p>` : `[${escapeMarkdown(label)}](<${url.replaceAll('>', '%3E')}>)`;
        break;
      }
      case 'paragraph': body = html ? `<p>${text || '<br>'}</p>` : text; break;
      default:
        // Fail explicitly rather than silently dropping tables, math, databases or unknown
        // blocks from a file the user expects to be complete.
        throw new Error(`Export does not yet support ${block.ty} blocks`);
    }
    if (html) return ['bulleted_list', 'numbered_list', 'todo_list', 'toggle_list', 'quote', 'callout'].includes(block.ty) ? body : `${body}${children ? `\n${children}` : ''}`;
    const indent = ' '.repeat(depth);
    return `${body.split('\n').map(line => `${indent}${line}`).join('\n')}${children && !['quote', 'callout'].includes(block.ty) ? `\n\n${children}` : ''}`;
  };
  const content = walk(doc.pageId, 0) + (footnoteExport?.definitions(html) ?? '');
  const equationStyles = equations ? `<style data-hyper-math-font="${HYPER_MATH_FONT_MARKER}">${hyperMathFontCss()}</style><style>${HYPER_MATH_FONT_FAMILY_CSS}.hyper-document-equation{display:block;margin:1rem 0;overflow-x:auto;break-inside:avoid}.hyper-document-inline-equation{display:inline;white-space:nowrap}@media print{.hyper-document-equation{overflow:visible}}</style>` : '';
  return html ? `<!doctype html>\n<html><head><meta charset="utf-8"><title>${hyperEscapeHtml(title)}</title>${equationStyles}</head><body>${title ? `<h1>${hyperEscapeHtml(title)}</h1>\n` : ''}${content}</body></html>\n` : `${title ? `# ${escapeMarkdown(title)}\n\n` : ''}${content}\n`;
}
