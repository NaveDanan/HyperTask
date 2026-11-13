import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperChildren, hyperEditText, hyperUpdateBlock } from './HyperDocumentModel';
import { hyperAddTableColumn, hyperAddTableRow, hyperDeleteTableColumn, hyperDeleteTableRow, hyperInsertTable, hyperSetTableColumnWidth, hyperTableCellLocation } from './HyperDocumentTable';
import { hyperExportDocument } from './HyperDocumentExport';

const empty = () => create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', data: '{}', childrenId: 'children' } }, meta: { childrenMap: { children: { children: [] } } } });
describe('Hyper document tables', () => {
  it('creates compatible row/cell/paragraph blocks without mutating the source', () => {
    const original = empty(), change = hyperInsertTable(original, 'root', '', 2, 2), doc = change.document;
    const table = doc.blocks[hyperChildren(doc, doc.blocks.root)[0]];
    expect(table.ty).toBe('simple_table');
    expect(hyperChildren(doc, table)).toHaveLength(2);
    for (const row of hyperChildren(doc, table)) {
      expect(doc.blocks[row].ty).toBe('simple_table_row');
      expect(hyperChildren(doc, doc.blocks[row])).toHaveLength(2);
      for (const cell of hyperChildren(doc, doc.blocks[row])) expect(doc.blocks[hyperChildren(doc, doc.blocks[cell])[0]].ty).toBe('paragraph');
    }
    expect(original.meta!.childrenMap.children.children).toEqual([]);
    expect(doc.blocks[change.focus!.id].ty).toBe('paragraph');
  });
  it('adds rectangular rows and columns and exports cell text safely', () => {
    const inserted = hyperInsertTable(empty(), 'root', '', 2, 2);
    const tableId = hyperChildren(inserted.document, inserted.document.blocks.root)[0];
    let doc = hyperEditText(inserted.document, inserted.focus!.id, [{ insert: 'A|B<script>' }]).document;
    doc = hyperAddTableRow(doc, tableId).document;
    doc = hyperAddTableColumn(doc, tableId).document;
    const rows = hyperChildren(doc, doc.blocks[tableId]);
    expect(rows).toHaveLength(3);
    for (const id of rows) expect(hyperChildren(doc, doc.blocks[id])).toHaveLength(3);
    const markdown = hyperExportDocument(doc, 'markdown');
    expect(markdown).toContain('| A\\|B\\<script\\> |');
    expect(markdown.split('\n').filter(line => line.startsWith('|'))).toHaveLength(4);
    const html = hyperExportDocument(doc, 'html');
    expect(html).toContain('<table><tbody>'); expect(html).toContain('<th scope="col">');
    expect(html).toContain('A|B&lt;script&gt;'); expect(html).not.toContain('<script>');
    expect((html.match(/<td>/g) ?? [])).toHaveLength(6);
  });
  it('adds an empty Markdown header when the table has no header row', () => {
    const inserted = hyperInsertTable(empty(), 'root', '', 1, 1);
    let doc = hyperEditText(inserted.document, inserted.focus!.id, [{ insert: 'data' }]).document;
    const table = hyperChildren(doc, doc.blocks.root)[0];
    doc = hyperUpdateBlock(doc, table, { enable_header_row: false }).document;
    expect(hyperExportDocument(doc, 'markdown')).toBe('|  |\n| --- |\n| data |\n');
  });
  it('rejects invalid dimensions and incomplete table exports', () => {
    expect(() => hyperInsertTable(empty(), 'root', '', 0, 3)).toThrow('dimensions');
    const { document: doc } = hyperInsertTable(empty(), 'root', '', 2, 2);
    const table = hyperChildren(doc, doc.blocks.root)[0], rows = hyperChildren(doc, doc.blocks[table]);
    doc.meta!.childrenMap[doc.blocks[rows[1]].childrenId].children.pop();
    expect(() => hyperExportDocument(doc, 'markdown')).toThrow('irregular');
  });
  it('resizes and deletes a selected column while preserving other cell text and widths', () => {
    const inserted = hyperInsertTable(empty(), 'root', '', 2, 3);
    let doc = hyperEditText(inserted.document, inserted.focus!.id, [{ insert: 'keep' }]).document;
    const location = hyperTableCellLocation(doc, inserted.focus!.id)!;
    doc = hyperSetTableColumnWidth(doc, location.tableId, 0, 180).document;
    doc = hyperSetTableColumnWidth(doc, location.tableId, 2, 260).document;
    const before = doc;
    doc = hyperDeleteTableColumn(doc, location.tableId, 1).document;
    expect(JSON.parse(doc.blocks[location.tableId].data).column_widths).toEqual({ 0: 180, 1: 260 });
    expect(hyperChildren(before, before.blocks[location.rowId])).toHaveLength(3);
    expect(hyperChildren(doc, doc.blocks[location.rowId])).toHaveLength(2);
    expect(hyperExportDocument(doc, 'markdown')).toContain('keep');
    expect(() => hyperSetTableColumnWidth(doc, location.tableId, 0, Infinity)).toThrow('width');
  });
  it('deletes rows with their content and protects the last row and column', () => {
    const inserted = hyperInsertTable(empty(), 'root', '', 2, 2);
    const location = hyperTableCellLocation(inserted.document, inserted.focus!.id)!;
    let doc = hyperDeleteTableRow(inserted.document, location.rowId).document;
    expect(doc.blocks[inserted.focus!.id]).toBeUndefined();
    const remainingRow = hyperChildren(doc, doc.blocks[location.tableId])[0];
    expect(() => hyperDeleteTableRow(doc, remainingRow)).toThrow('at least one');
    doc = hyperDeleteTableColumn(doc, location.tableId, 1).document;
    expect(() => hyperDeleteTableColumn(doc, location.tableId, 0)).toThrow('at least one');
    expect(hyperTableCellLocation(doc, 'missing')).toBeNull();
  });
});
