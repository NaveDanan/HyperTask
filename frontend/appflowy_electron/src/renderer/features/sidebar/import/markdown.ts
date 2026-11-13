// A Markdown → AppFlowy editor JSON converter, the counterpart of customMarkdownToDocument
// (shared/markdown_to_document.dart) for the import panel. It covers the common block and
// inline syntax; the JSON is turned into DocumentDataPB by DocumentEventConvertDataToDocument.

import { hyperCollectMarkdownFootnotes, hyperMarkdownFootnoteLines, hyperMarkdownFootnoteReference, type HyperMarkdownFootnotes } from '../../document-footnote/HyperDocumentFootnoteMarkdown';
import { hyperInlineMathMarkdownPattern, hyperParseInlineMathMarkdown } from '../../document-inline-math/HyperInlineMathPortable';
import { hyperMarkdownStyledTextPattern, hyperParseMarkdownStyledSpan } from '../../document-format/HyperMarkdownStyledText';

export interface EditorBlock {
  type: string;
  data: Record<string, unknown>;
  children: EditorBlock[];
}

type Op = { insert: string; attributes?: Record<string, unknown> };

/** Inline syntax: **bold**, *italic* / _italic_, `code`, ~~strikethrough~~, [text](href). */
export function parseInline(text: string, footnotes?: HyperMarkdownFootnotes, allowInlineMath = true): Op[] {
  const ops: Op[] = [];
  let escapePrefix = '\uE000';
  while (text.includes(escapePrefix)) escapePrefix += '\uE000';
  const escaped: Array<{ literal: string; raw: string }> = [];
  const protectedText = text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, (raw, literal: string) => {
    const index = escaped.push({ raw, literal }) - 1;
    return `${escapePrefix}${index}\uE001`;
  });
  const restore = (value: string, code = false) => value.replace(new RegExp(`${escapePrefix}(\\d+)\uE001`, 'g'), (_, index: string) => escaped[Number(index)]?.[code ? 'raw' : 'literal'] ?? '');
  const push = (insert: string, attributes?: Record<string, unknown>) => {
    insert = restore(insert, attributes?.code === true);
    if (!insert) return;
    const last = ops.at(-1);
    if (last && JSON.stringify(last.attributes ?? null) === JSON.stringify(attributes ?? null)) last.insert += insert;
    else ops.push(attributes ? { insert, attributes } : { insert });
  };
  const ordinary = /(\*\*\*|___)(.+?)\1|(\*\*|__)(.+?)\3|~~(.+?)~~|(?<!`)(`+)(?!`)([\s\S]*?)\6(?!`)|\[([^\]]+)\]\((<[^>\r\n]+>|[^)\s]+)\)|(\*|_)(?!\s)(.+?)(?<!\s)\10|\[\^((?:\\.|[^\]\\\r\n])+)\](?!:)/;
  const pattern = new RegExp(ordinary.source + (allowInlineMath ? `|(?<inlineMath>${hyperInlineMathMarkdownPattern})|(?<styledText>${hyperMarkdownStyledTextPattern})` : ''), 'g');
  let index = 0;
  for (const match of protectedText.matchAll(pattern)) {
    push(protectedText.slice(index, match.index));
    if (match[2] !== undefined) {
      for (const op of parseInline(match[2], footnotes, allowInlineMath)) push(op.insert, { ...op.attributes, bold: true, italic: true });
    } else if (match[4] !== undefined) {
      for (const op of parseInline(match[4], footnotes, allowInlineMath)) push(op.insert, { ...op.attributes, bold: true });
    } else if (match[5] !== undefined) {
      for (const op of parseInline(match[5], footnotes, allowInlineMath)) push(op.insert, { ...op.attributes, strikethrough: true });
    } else if (match[7] !== undefined) {
      const code = match[7].startsWith(' ') && match[7].endsWith(' ') && /[^ ]/.test(match[7]) ? match[7].slice(1, -1) : match[7];
      push(code, { code: true });
    } else if (match[8] !== undefined) {
      const href = restore(match[9].startsWith('<') && match[9].endsWith('>') ? match[9].slice(1, -1) : match[9]);
      for (const op of parseInline(match[8], footnotes, false)) push(op.insert, { ...op.attributes, href });
    } else if (match[11] !== undefined) {
      for (const op of parseInline(match[11], footnotes, allowInlineMath)) push(op.insert, { ...op.attributes, italic: true });
    }
    if (match[12] !== undefined) {
      const reference = hyperMarkdownFootnoteReference(restore(match[12]), footnotes);
      if (reference) push(reference.insert as string, reference.attributes);
      else push(match[0]);
    }
    if (match.groups?.inlineMath !== undefined) {
      const atom = hyperParseInlineMathMarkdown(match.groups.inlineMath);
      if (atom) push(atom.insert as string, atom.attributes); else push(match.groups.inlineMath);
    }
    if (match.groups?.styledText !== undefined) {
      const run = hyperParseMarkdownStyledSpan(match.groups.styledText);
      if (run) push(run.insert as string, run.attributes); else push(match.groups.styledText);
    }
    index = (match.index ?? 0) + match[0].length;
  }
  push(protectedText.slice(index));
  return ops;
}

interface ListLine {
  indent: number;
  contentIndent: number;
  block: EditorBlock;
}

/** Parses Markdown into a page block (the editor's JSON document root). */
export function markdownToEditorJson(markdown: string): EditorBlock {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n'), footnotes = hyperCollectMarkdownFootnotes(lines);
  const parsed = parseMarkdownLines(hyperMarkdownFootnoteLines(lines, footnotes), footnotes);
  return footnotes.used.size === footnotes.definitions.size ? parsed : parseMarkdownLines(hyperMarkdownFootnoteLines(lines, footnotes, true), footnotes);
}
function parseMarkdownLines(lines: string[], footnotes: HyperMarkdownFootnotes): EditorBlock {
  const textBlock = (type: string, text: string, data: Record<string, unknown> = {}): EditorBlock => ({ type, data: { ...data, delta: parseInline(text, footnotes) }, children: [] });
  const page: EditorBlock = { type: 'page', data: {}, children: [] };
  let paragraph: string[] = [];
  let paragraphParent: EditorBlock | null = null;
  let listStack: ListLine[] = [];

  const flushParagraph = () => {
    if (paragraph.length) (paragraphParent?.children ?? page.children).push(textBlock('paragraph', paragraph.join(' ')));
    paragraph = [];
    paragraphParent = null;
  };
  const parentFor = (indent: number) => {
    while (listStack.length && indent < listStack.at(-1)!.contentIndent) listStack.pop();
    return listStack.at(-1)?.block ?? null;
  };
  const addBlock = (indent: number, block: EditorBlock) => (parentFor(indent)?.children ?? page.children).push(block);
  const addListItem = (indent: number, contentIndent: number, block: EditorBlock) => {
    while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop();
    addBlock(indent, block);
    listStack.push({ indent, contentIndent, block });
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const indent = raw.length - raw.trimStart().length;
    const trimmed = line.trim();

    const fence = /^(`{3,}|~{3,})\s*([\w+-]*)/.exec(trimmed);
    if (fence) {
      flushParagraph();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) code.push(lines[i].startsWith(' '.repeat(indent)) ? lines[i].slice(indent) : lines[i]);
      addBlock(indent, { type: 'code', data: { delta: [{ insert: code.join('\n') }], language: fence[2] || null }, children: [] });
      continue;
    }
    // Read display math before inline escapes or Markdown formatting touch TeX.
    // Only closed, standalone delimiters become a block; incomplete input stays text.
    if (trimmed === '$$') {
      let end = i + 1;
      while (end < lines.length && lines[end].trim() !== '$$') end++;
      if (end < lines.length) {
        flushParagraph();
        const prefix = ' '.repeat(indent);
        const formula = lines.slice(i + 1, end).map(value => value.startsWith(prefix) ? value.slice(indent) : value).join('\n');
        addBlock(indent, { type: 'math_equation', data: { formula }, children: [] });
        i = end;
        continue;
      }
    } else if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && !trimmed.startsWith('$$$') && !trimmed.endsWith('$$$')) {
      const formula = trimmed.slice(2, -2);
      if (formula && !formula.includes('$$')) {
        flushParagraph();
        addBlock(indent, { type: 'math_equation', data: { formula }, children: [] });
        continue;
      }
    }
    if (trimmed === '') {
      flushParagraph();
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(trimmed))) {
      flushParagraph();
      addBlock(indent, textBlock('heading', m[2], { level: m[1].length }));
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      addBlock(indent, { type: 'divider', data: {}, children: [] });
    } else if ((m = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(trimmed))) {
      flushParagraph();
      addListItem(indent, indent + 2, textBlock('todo_list', m[2], { checked: m[1].toLowerCase() === 'x' }));
    } else if ((m = /^[-*+]\s+(.*)$/.exec(trimmed))) {
      flushParagraph();
      addListItem(indent, indent + 2, textBlock('bulleted_list', m[1]));
    } else if ((m = /^(\d+[.)]\s+)(.*)$/.exec(trimmed))) {
      flushParagraph();
      addListItem(indent, indent + m[1].length, textBlock('numbered_list', m[2]));
    } else if ((m = /^>\s?(.*)$/.exec(trimmed))) {
      flushParagraph();
      addBlock(indent, textBlock('quote', m[1]));
    } else if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(trimmed))) {
      flushParagraph();
      addBlock(indent, { type: 'image', data: { url: m[2], align: 'center' }, children: [] });
    } else {
      if (!paragraph.length) paragraphParent = parentFor(indent);
      paragraph.push(trimmed);
    }
  }
  flushParagraph();
  if (page.children.length === 0) page.children.push(textBlock('paragraph', ''));
  return page;
}
