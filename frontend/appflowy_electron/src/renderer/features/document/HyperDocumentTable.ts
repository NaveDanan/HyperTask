import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockData, hyperChildren, hyperDeleteBlock, hyperInsertBlock, hyperUpdateBlock, type HyperDocumentChange } from './HyperDocumentModel';

function append(change: HyperDocumentChange, parent: string, previous: string, type: string) {
  const next = hyperInsertBlock(change.document, parent, previous, type);
  change.document = next.document; change.actions.push(...next.actions);
  return next.focus!.id;
}
function addRow(change: HyperDocumentChange, tableId: string, columns: number) {
  const table = change.document.blocks[tableId];
  if (table?.ty !== 'simple_table') throw new Error('Not a table');
  const row = append(change, tableId, hyperChildren(change.document, table).at(-1) ?? '', 'simple_table_row');
  let previous = '';
  for (let column = 0; column < columns; column++) {
    previous = append(change, row, previous, 'simple_table_cell');
    const paragraph = append(change, previous, '', 'paragraph');
    change.focus ??= { id: paragraph, offset: 0 };
  }
}
export function hyperInsertTable(doc: DocumentDataPB, parent: string, previous: string, rows = 3, columns = 3) {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || rows > 100 || columns > 100) throw new Error('Invalid table dimensions');
  const change = hyperInsertBlock(doc, parent, previous, 'simple_table', { enable_header_row: true, enable_header_column: false, distribute_column_widths_evenly: true });
  const tableId = change.focus!.id;
  delete change.focus;
  for (let row = 0; row < rows; row++) addRow(change, tableId, columns);
  return change;
}
export function hyperAddTableRow(doc: DocumentDataPB, tableId: string) {
  const table = doc.blocks[tableId];
  if (table?.ty !== 'simple_table') throw new Error('Not a table');
  const first = doc.blocks[hyperChildren(doc, table)[0]];
  const change: HyperDocumentChange = { document: doc, actions: [] };
  addRow(change, tableId, first ? hyperChildren(doc, first).length : 1);
  return change;
}
export function hyperAddTableColumn(doc: DocumentDataPB, tableId: string) {
  const table = doc.blocks[tableId];
  if (table?.ty !== 'simple_table') throw new Error('Not a table');
  const change: HyperDocumentChange = { document: doc, actions: [] };
  for (const rowId of hyperChildren(doc, table)) {
    const cell = append(change, rowId, hyperChildren(change.document, change.document.blocks[rowId]).at(-1) ?? '', 'simple_table_cell');
    const paragraph = append(change, cell, '', 'paragraph');
    change.focus ??= { id: paragraph, offset: 0 };
  }
  return change;
}

export function hyperTableCellLocation(doc: DocumentDataPB, blockId: string) {
  const visited = new Set<string>();
  let block = doc.blocks[blockId];
  while (block && !visited.has(block.id)) {
    visited.add(block.id);
    if (block.ty === 'simple_table_cell') {
      const row = doc.blocks[block.parentId], table = row && doc.blocks[row.parentId];
      if (row?.ty !== 'simple_table_row' || table?.ty !== 'simple_table') return null;
      const column = hyperChildren(doc, row).indexOf(block.id);
      return column < 0 ? null : { tableId: table.id, rowId: row.id, cellId: block.id, column };
    }
    block = doc.blocks[block.parentId];
  }
  return null;
}

export function hyperDeleteTableRow(doc: DocumentDataPB, rowId: string) {
  const row = doc.blocks[rowId], table = row && doc.blocks[row.parentId];
  if (row?.ty !== 'simple_table_row' || table?.ty !== 'simple_table') throw new Error('Not a table row');
  if (hyperChildren(doc, table).length <= 1) throw new Error('A table needs at least one row');
  return hyperDeleteBlock(doc, rowId);
}

export function hyperDeleteTableColumn(doc: DocumentDataPB, tableId: string, column: number) {
  const table = doc.blocks[tableId];
  if (table?.ty !== 'simple_table' || !Number.isInteger(column) || column < 0) throw new Error('Invalid table column');
  const rows = hyperChildren(doc, table), cells = rows.map(id => hyperChildren(doc, doc.blocks[id]));
  if (!cells.length || cells.some(row => row.length <= 1 || !row[column])) throw new Error('A table needs at least one column');
  let change: HyperDocumentChange = { document: doc, actions: [] };
  for (const row of cells) {
    const next = hyperDeleteBlock(change.document, row[column]);
    change = { document: next.document, actions: [...change.actions, ...next.actions] };
  }
  const widths = hyperBlockData(table).column_widths;
  if (widths && typeof widths === 'object' && !Array.isArray(widths)) {
    const nextWidths: Record<string, unknown> = {};
    for (const [key, width] of Object.entries(widths)) {
      const index = Number(key);
      if (Number.isInteger(index) && index >= 0 && index !== column) nextWidths[String(index > column ? index - 1 : index)] = width;
    }
    const updated = hyperUpdateBlock(change.document, tableId, { column_widths: nextWidths });
    change = { document: updated.document, actions: [...change.actions, ...updated.actions] };
  }
  return change;
}

export function hyperSetTableColumnWidth(doc: DocumentDataPB, tableId: string, column: number, width: number) {
  const table = doc.blocks[tableId], first = table && doc.blocks[hyperChildren(doc, table)[0]];
  if (table?.ty !== 'simple_table' || !first || !Number.isInteger(column) || column < 0 || column >= hyperChildren(doc, first).length) throw new Error('Invalid table column');
  if (!Number.isFinite(width) || width < 80 || width > 1200) throw new Error('Column width must be between 80 and 1200');
  const existing = hyperBlockData(table).column_widths;
  const widths = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  return hyperUpdateBlock(doc, tableId, { column_widths: { ...widths, [column]: width }, distribute_column_widths_evenly: false });
}
