import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockText, hyperChildren, hyperEditText, hyperPlainText } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperApplyDocumentSlash, hyperCaptureDocumentSlash, hyperDocumentSlashMatches, hyperFilterDocumentSlashCommands, hyperUpdateDocumentSlashQuery, type HyperDocumentSlashCommand } from '../src/renderer/features/document-slash/HyperDocumentSlashModel';

function document(text = '/') {
  return create(DocumentDataPBSchema, { pageId: 'root', blocks: {
    root: { id: 'root', ty: 'page', childrenId: 'children', data: '{}' },
    p: { id: 'p', parentId: 'root', ty: 'paragraph', childrenId: 'pc', data: JSON.stringify({ delta: [{ insert: text, attributes: { bold: true } }], unknown: 'keep' }) },
    child: { id: 'child', parentId: 'p', ty: 'paragraph', childrenId: 'cc', data: JSON.stringify({ delta: [{ insert: 'Nested content' }] }) },
    tail: { id: 'tail', parentId: 'root', ty: 'paragraph', childrenId: 'tc', data: JSON.stringify({ delta: [{ insert: 'Unrelated text' }] }) },
  }, meta: { childrenMap: { children: { children: ['p', 'tail'] }, pc: { children: ['child'] }, cc: { children: [] }, tc: { children: [] } } } });
}
const commands: HyperDocumentSlashCommand[] = [
  { id: 'p', type: 'paragraph', label: 'Texte' }, { id: 'h1', type: 'heading', level: 1, label: 'Titre 1' },
  { id: 'h2', type: 'heading', level: 2, label: 'Titre 2' }, { id: 'todo', type: 'todo_list', label: 'Tâches' },
  { id: 'table', type: 'simple_table', label: 'Tableau' },
];
describe('Hyper searchable slash commands', () => {
  it('filters translated labels, accents, aliases and multiple search words', () => {
    expect(hyperFilterDocumentSlashCommands(commands, '').map(command => command.id)).toEqual(['p', 'h1', 'h2', 'todo', 'table']);
    expect(hyperFilterDocumentSlashCommands(commands, 'heading2').map(command => command.id)).toEqual(['h2']);
    expect(hyperFilterDocumentSlashCommands(commands, 'titre 1').map(command => command.id)).toEqual(['h1']);
    expect(hyperFilterDocumentSlashCommands(commands, 'taches').map(command => command.id)).toEqual(['todo']);
    expect(hyperFilterDocumentSlashCommands(commands, 'checkbox').map(command => command.id)).toEqual(['todo']);
    expect(hyperFilterDocumentSlashCommands(commands, 'missing')).toEqual([]);
  });
  it('does not activate in ordinary inline text, code, paths, embedded runs or detached blocks', () => {
    for (const text of ['prefix /heading', '//comment', '/path/file', '/multi\nline', '/heading\n', '/heading\r']) expect(hyperCaptureDocumentSlash(document(text), 'p')).toBeNull();
    const code = document('/heading'); code.blocks.p.ty = 'code'; expect(hyperCaptureDocumentSlash(code, 'p')).toBeNull();
    const embedded = document(); embedded.blocks.p.data = JSON.stringify({ delta: [{ insert: '/' }, { insert: { mention: 'page' } }] }); expect(hyperCaptureDocumentSlash(embedded, 'p')).toBeNull();
    const detached = document(); detached.meta!.childrenMap.children.children = ['tail']; expect(() => hyperCaptureDocumentSlash(detached, 'p')).toThrow('position changed');
  });
  it('keeps each typed query in the document with its formatting before a command is selected', () => {
    const original = document(), target = hyperCaptureDocumentSlash(original, 'p')!;
    const updated = hyperUpdateDocumentSlashQuery(original, target, 'heading 2');
    expect(hyperPlainText(hyperBlockText(updated.document, updated.document.blocks.p))).toBe('/heading 2');
    expect(hyperBlockText(updated.document, updated.document.blocks.p)[0].attributes?.bold).toBe(true);
    expect(hyperPlainText(hyperBlockText(original, original.blocks.p))).toBe('/');
    expect(hyperCaptureDocumentSlash(updated.document, 'p')!.query).toBe('heading 2');
    const path = hyperUpdateDocumentSlashQuery(original, target, 'path/file');
    expect(hyperPlainText(hyperBlockText(path.document, path.document.blocks.p))).toBe('/path/file');
    expect(hyperCaptureDocumentSlash(path.document, 'p')).toBeNull();
  });
  it('converts only the exact command block and preserves its children and unknown settings', () => {
    const doc = document('/heading2'), saved = JSON.stringify(doc);
    const change = hyperApplyDocumentSlash(doc, hyperCaptureDocumentSlash(doc, 'p')!, commands[2]);
    expect(change.document.blocks.p.ty).toBe('heading');
    expect(JSON.parse(change.document.blocks.p.data)).toMatchObject({ level: 2, unknown: 'keep' });
    expect(hyperPlainText(hyperBlockText(change.document, change.document.blocks.p))).toBe('');
    expect(hyperChildren(change.document, change.document.blocks.p)).toEqual(['child']);
    expect(hyperPlainText(hyperBlockText(change.document, change.document.blocks.child))).toBe('Nested content');
    expect(hyperPlainText(hyperBlockText(change.document, change.document.blocks.tail))).toBe('Unrelated text');
    expect(JSON.stringify(doc)).toBe(saved);
  });
  it('adds tables after the command paragraph and keeps unrelated content', () => {
    const doc = document('/table'), change = hyperApplyDocumentSlash(doc, hyperCaptureDocumentSlash(doc, 'p')!, commands[4]);
    const children = hyperChildren(change.document, change.document.blocks.root);
    expect(children).toHaveLength(3); expect(children[0]).toBe('p'); expect(children[2]).toBe('tail');
    expect(change.document.blocks[children[1]].ty).toBe('simple_table');
    expect(hyperChildren(change.document, change.document.blocks.p)).toEqual(['child']);
    expect(hyperPlainText(hyperBlockText(change.document, change.document.blocks.p))).toBe('');
  });
  it('inserts complete column layouts and leaves date queries untouched until the picker saves', () => {
    const doc = document('/columns'), target = hyperCaptureDocumentSlash(doc, 'p')!;
    const change = hyperApplyDocumentSlash(doc, target, { id: 'columns-3', type: 'simple_columns', columns: 3, label: 'Three columns' });
    const layoutId = hyperChildren(change.document, change.document.blocks.root)[1], layout = change.document.blocks[layoutId];
    expect(layout.ty).toBe('simple_columns');
    expect(hyperChildren(change.document, layout)).toHaveLength(3);
    expect(hyperPlainText(hyperBlockText(change.document, change.document.blocks.p))).toBe('');
    expect(hyperChildren(change.document, change.document.blocks.p)).toEqual(['child']);
    expect(change.document.blocks[change.focus!.id].ty).toBe('paragraph');
    const date = document('/reminder'), snapshot = JSON.stringify(date);
    const pending = hyperApplyDocumentSlash(date, hyperCaptureDocumentSlash(date, 'p')!, { id: 'date', type: 'hyper_date_mention', label: 'Date or reminder' });
    expect(pending.actions).toEqual([]); expect(JSON.stringify(pending.document)).toBe(snapshot);
    expect(hyperFilterDocumentSlashCommands([{ id: 'date', type: 'hyper_date_mention', label: 'Date' }], 'reminder')).toHaveLength(1);
    expect(() => hyperApplyDocumentSlash(doc, target, { id: 'bad-columns', type: 'simple_columns', columns: 5 as 2, label: 'Invalid' })).toThrow('two, three or four');
  });
  it('rejects stale text, changed block types, deleted targets and different documents', () => {
    const doc = document('/heading'), target = hyperCaptureDocumentSlash(doc, 'p')!;
    const changed = hyperEditText(doc, 'p', [{ insert: '/heading plus remote text' }]).document;
    expect(hyperDocumentSlashMatches(changed, target)).toBe(false);
    expect(() => hyperApplyDocumentSlash(changed, target, commands[1])).toThrow('position changed');
    const deleted = document('/heading'); delete deleted.blocks.p;
    expect(() => hyperUpdateDocumentSlashQuery(deleted, target, '')).toThrow('position changed');
    const converted = document('/heading'); converted.blocks.p.ty = 'quote';
    expect(() => hyperApplyDocumentSlash(converted, target, commands[1])).toThrow('position changed');
    const another = document('/heading'); another.pageId = 'another';
    expect(() => hyperApplyDocumentSlash(another, target, commands[1])).toThrow('position changed');
  });
  it('refuses unknown commands and invalid heading levels before editing', () => {
    const doc = document(), target = hyperCaptureDocumentSlash(doc, 'p')!;
    for (const command of [{ id: 'future', type: 'future', label: 'Future' }, { id: 'heading', type: 'heading', level: 10, label: 'Heading' }]) expect(() => hyperApplyDocumentSlash(doc, target, command)).toThrow('available');
    expect(hyperPlainText(hyperBlockText(doc, doc.blocks.p))).toBe('/');
  });
});
