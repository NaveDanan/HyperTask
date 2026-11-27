import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { expect, it } from 'vitest';
import {
  buildDocJson,
  ComposerListExtensions,
  moveOrderedListItems,
  serializeEditorDoc,
} from './HyperPromptDocument';

const schema = getSchema([
  StarterKit.configure({ bulletList: false, listItem: false, listKeymap: false, orderedList: false }),
  ...ComposerListExtensions,
]);

function draft(text: string, items: string[]) {
  const doc = schema.nodeFromJSON(buildDocJson(text, () => null));
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock && items.includes(node.textContent)) positions.push(pos + 1);
  });
  return EditorState.create({ doc, schema, selection: TextSelection.create(doc, positions[0]!, positions.at(-1)) });
}

function move(state: EditorState, direction: 'in' | 'out') {
  let current = state;
  moveOrderedListItems(state, direction, tr => { current = state.apply(tr); });
  return current;
}

it('starts a separate count under the previous item and round-trips the nested draft', () => {
  const state = draft('1. One\n2. **Two**\n3. Three', ['Two']);
  const nested = move(state, 'in');
  const text = serializeEditorDoc(nested.doc).value;
  expect(text).toBe('1. One\n   1. **Two**\n2. Three');
  expect(draft(text, ['Two']).doc.eq(nested.doc)).toBe(true);
  expect(nested.selection.$from.parent.textContent).toBe('Two');
  expect(serializeEditorDoc(move(nested, 'out').doc).value).toBe('1. One\n2. **Two**\n3. Three');
});

it('continues an existing sublist and keeps the parent delimiter and starting number', () => {
  const state = draft('9) Parent\n   1) First\n10) Next\n11) Last', ['Next', 'Last']);
  const nested = move(state, 'in');
  expect(serializeEditorDoc(nested.doc).value).toBe('9) Parent\n   1) First\n   2) Next\n   3) Last');
  expect(serializeEditorDoc(move(nested, 'out').doc).value).toBe('9) Parent\n   1) First\n10) Next\n11) Last');
});

it('moves a nested item and its descendants up exactly one level', () => {
  const state = draft('1. Top\n   1. Middle\n      1. Child\n         1. Descendant', ['Child']);
  const moved = move(state, 'out');
  expect(serializeEditorDoc(moved.doc).value).toBe('1. Top\n   1. Middle\n   2. Child\n      1. Descendant');
});

it('allows focus to leave when the item cannot move in the requested direction', () => {
  const state = draft('1. One\n2. Two', ['One']);
  expect(move(state, 'in')).toBe(state);
  expect(move(state, 'out')).toBe(state);
  const paragraph = draft('Paragraph', ['Paragraph']);
  expect(move(paragraph, 'in')).toBe(paragraph);
});
