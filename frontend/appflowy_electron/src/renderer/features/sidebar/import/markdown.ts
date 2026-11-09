// A Markdown → AppFlowy editor JSON converter, the counterpart of customMarkdownToDocument
// (shared/markdown_to_document.dart) for the import panel. It covers the common block and
// inline syntax; the JSON is turned into DocumentDataPB by DocumentEventConvertDataToDocument.

export interface EditorBlock {
  type: string;
  data: Record<string, unknown>;
  children: EditorBlock[];
}

type Op = { insert: string; attributes?: Record<string, unknown> };

/** Inline syntax: **bold**, *italic* / _italic_, `code`, ~~strikethrough~~, [text](href). */
export function parseInline(text: string): Op[] {
  const ops: Op[] = [];
  const push = (insert: string, attributes?: Record<string, unknown>) => {
    if (!insert) return;
    const last = ops.at(-1);
    if (last && JSON.stringify(last.attributes ?? null) === JSON.stringify(attributes ?? null)) last.insert += insert;
    else ops.push(attributes ? { insert, attributes } : { insert });
  };
  const pattern = /(\*\*|__)(.+?)\1|~~(.+?)~~|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(\*|_)(?!\s)(.+?)(?<!\s)\7/g;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    push(text.slice(index, match.index));
    if (match[2] !== undefined) {
      for (const op of parseInline(match[2])) push(op.insert, { ...op.attributes, bold: true });
    } else if (match[3] !== undefined) {
      for (const op of parseInline(match[3])) push(op.insert, { ...op.attributes, strikethrough: true });
    } else if (match[4] !== undefined) {
      push(match[4], { code: true });
    } else if (match[5] !== undefined) {
      for (const op of parseInline(match[5])) push(op.insert, { ...op.attributes, href: match[6] });
    } else if (match[8] !== undefined) {
      for (const op of parseInline(match[8])) push(op.insert, { ...op.attributes, italic: true });
    }
    index = (match.index ?? 0) + match[0].length;
  }
  push(text.slice(index));
  return ops;
}

const textBlock = (type: string, text: string, data: Record<string, unknown> = {}): EditorBlock => ({
  type,
  data: { ...data, delta: parseInline(text) },
  children: [],
});

interface ListLine {
  indent: number;
  block: EditorBlock;
}

/** Parses Markdown into a page block (the editor's JSON document root). */
export function markdownToEditorJson(markdown: string): EditorBlock {
  const page: EditorBlock = { type: 'page', data: {}, children: [] };
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  let listStack: ListLine[] = [];

  const flushParagraph = () => {
    if (paragraph.length) page.children.push(textBlock('paragraph', paragraph.join(' ')));
    paragraph = [];
  };
  const addListItem = (indent: number, block: EditorBlock) => {
    while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop();
    const parent = listStack.at(-1);
    if (parent) parent.block.children.push(block);
    else page.children.push(block);
    listStack.push({ indent, block });
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const indent = raw.length - raw.trimStart().length;
    const trimmed = line.trim();

    const fence = /^(```|~~~)\s*([\w+-]*)/.exec(trimmed);
    if (fence) {
      flushParagraph();
      listStack = [];
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) code.push(lines[i]);
      page.children.push({ type: 'code', data: { delta: [{ insert: code.join('\n') }], language: fence[2] || null }, children: [] });
      continue;
    }
    if (trimmed === '') {
      flushParagraph();
      listStack = [];
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(trimmed))) {
      flushParagraph();
      listStack = [];
      page.children.push(textBlock('heading', m[2], { level: m[1].length }));
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      listStack = [];
      page.children.push({ type: 'divider', data: {}, children: [] });
    } else if ((m = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(trimmed))) {
      flushParagraph();
      addListItem(indent, textBlock('todo_list', m[2], { checked: m[1].toLowerCase() === 'x' }));
    } else if ((m = /^[-*+]\s+(.*)$/.exec(trimmed))) {
      flushParagraph();
      addListItem(indent, textBlock('bulleted_list', m[1]));
    } else if ((m = /^\d+[.)]\s+(.*)$/.exec(trimmed))) {
      flushParagraph();
      addListItem(indent, textBlock('numbered_list', m[1]));
    } else if ((m = /^>\s?(.*)$/.exec(trimmed))) {
      flushParagraph();
      listStack = [];
      page.children.push(textBlock('quote', m[1]));
    } else if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(trimmed))) {
      flushParagraph();
      listStack = [];
      page.children.push({ type: 'image', data: { url: m[2], align: 'center' }, children: [] });
    } else {
      listStack = [];
      paragraph.push(trimmed);
    }
  }
  flushParagraph();
  if (page.children.length === 0) page.children.push(textBlock('paragraph', ''));
  return page;
}
