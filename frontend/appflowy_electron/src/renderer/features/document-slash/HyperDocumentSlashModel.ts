import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperChildren, hyperEditText, hyperPlainText, hyperTextTypes, hyperUpdateBlock, type HyperDocumentChange } from '../document/HyperDocumentModel';
import { hyperInsertTable } from '../document/HyperDocumentTable';
import { hyperInsertDocumentColumns, type HyperDocumentColumnCount } from '../document-columns/HyperDocumentColumnsModel';

export interface HyperDocumentSlashTarget {
  pageId: string;
  blockId: string;
  parentId: string;
  type: string;
  childrenId: string;
  externalId: string;
  runs: string;
  query: string;
}
export interface HyperDocumentSlashCommand { id: string; type: string; level?: number; columns?: HyperDocumentColumnCount; label: string; keywords?: string[] }
const aliases: Record<string, string[]> = {
  paragraph: ['text', 'paragraph'], heading: ['heading', 'title'], bulleted_list: ['bullet', 'list', 'unordered'],
  numbered_list: ['number', 'list', 'ordered'], todo_list: ['task', 'todo', 'checklist', 'checkbox'], toggle_list: ['toggle', 'collapse'],
  quote: ['quote', 'blockquote'], callout: ['callout', 'notice'], code: ['code', 'snippet'], divider: ['divider', 'separator', 'line'], simple_table: ['table', 'grid'],
  simple_columns: ['column', 'columns', 'layout'],
  hyper_date_mention: ['date', 'reminder', 'calendar', 'mention'],
  math_equation: ['math', 'equation', 'latex', 'tex'],
};
function connected(document: DocumentDataPB, id: string) {
  const seen = new Set<string>();
  while (id !== document.pageId) {
    if (seen.has(id)) throw new Error('The slash command position contains a cycle.');
    seen.add(id);
    const block = document.blocks[id], parent = block && document.blocks[block.parentId];
    if (!parent || !hyperChildren(document, parent).includes(id)) throw new Error('The slash command position changed. Type / again.');
    id = parent.id;
  }
  if (!document.blocks[id] || !document.meta) throw new Error('The document is not ready for a slash command.');
}
export function hyperCaptureDocumentSlash(document: DocumentDataPB, id: string): HyperDocumentSlashTarget | null {
  const block = document.blocks[id];
  if (!block || !hyperTextTypes.has(block.ty) || block.ty === 'code') return null;
  const runs = hyperBlockText(document, block), text = hyperPlainText(runs);
  // Only the complete leading slash/query belongs to this command. Inline text,
  // pasted paths and embedded runs are never erased to make room for a block.
  if (!text.startsWith('/') || text.length > 257 || /[/\r\n]/.test(text.slice(1)) || runs.some(run => typeof run.insert !== 'string')) return null;
  connected(document, id);
  return { pageId: document.pageId, blockId: id, parentId: block.parentId, type: block.ty, childrenId: block.childrenId, externalId: JSON.stringify(block.oneOfExternalId), runs: JSON.stringify(runs), query: text.slice(1) };
}
export function hyperDocumentSlashMatches(document: DocumentDataPB, target: HyperDocumentSlashTarget): boolean {
  try {
    const current = hyperCaptureDocumentSlash(document, target.blockId);
    return !!current && (Object.keys(target) as Array<keyof HyperDocumentSlashTarget>).every(key => current[key] === target[key]);
  } catch { return false; }
}
function assertTarget(document: DocumentDataPB, target: HyperDocumentSlashTarget) {
  if (!hyperDocumentSlashMatches(document, target)) throw new Error('The slash command position changed. Type / again.');
}
export function hyperUpdateDocumentSlashQuery(document: DocumentDataPB, target: HyperDocumentSlashTarget, query: string): HyperDocumentChange {
  assertTarget(document, target);
  if (query.length > 256 || /[\r\n]/.test(query)) throw new Error('Use a single-line slash command query.');
  const first = hyperBlockText(document, document.blocks[target.blockId])[0];
  return hyperEditText(document, target.blockId, [{ insert: `/${query}`, ...(first?.attributes ? { attributes: first.attributes } : {}) }]);
}
export function hyperApplyDocumentSlash(document: DocumentDataPB, target: HyperDocumentSlashTarget, command: HyperDocumentSlashCommand): HyperDocumentChange {
  assertTarget(document, target);
  if (!aliases[command.type] || (command.type === 'heading' && ![1, 2, 3].includes(command.level ?? 0))) throw new Error('Choose an available slash command.');
  // The date dialog replaces this captured query only after Save; cancellation keeps it.
  if (command.type === 'hyper_date_mention' || command.type === 'math_equation') return { document, actions: [], focus: { id: target.blockId, offset: 0 } };
  if (command.type === 'simple_columns') {
    if (![2, 3, 4].includes(command.columns ?? 0)) throw new Error('Choose two, three or four columns.');
    const inserted = hyperInsertDocumentColumns(document, target.parentId, target.blockId, command.columns!);
    const cleared = hyperEditText(inserted.document, target.blockId, []);
    return { document: cleared.document, actions: [...inserted.actions, ...cleared.actions], focus: inserted.focus };
  }
  if (command.type === 'simple_table') {
    const inserted = hyperInsertTable(document, target.parentId, target.blockId);
    const cleared = hyperEditText(inserted.document, target.blockId, []);
    return { document: cleared.document, actions: [...inserted.actions, ...cleared.actions], focus: inserted.focus };
  }
  const cleared = hyperEditText(document, target.blockId, []);
  const converted = hyperUpdateBlock(cleared.document, target.blockId, command.level ? { level: command.level } : {}, command.type);
  return { document: converted.document, actions: [...cleared.actions, ...converted.actions], focus: { id: target.blockId, offset: 0 } };
}
const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
export function hyperFilterDocumentSlashCommands(commands: HyperDocumentSlashCommand[], query: string) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return commands.filter(command => {
    const haystack = normalize([command.label, command.type, ...(aliases[command.type] ?? []), ...(command.keywords ?? []), ...(command.level ? [`h${command.level}`, `heading${command.level}`] : [])].join(' '));
    return words.every(word => haystack.includes(word));
  });
}
