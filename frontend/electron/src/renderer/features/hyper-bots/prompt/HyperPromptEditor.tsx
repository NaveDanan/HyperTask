// Editor behavior adapted from t3code (apps/web/src/components/ComposerPromptEditorTiptap.tsx),
// Copyright (c) 2026 T3 Tools Inc., MIT License. See LICENSE.t3code.
import { Extension, Node, type Editor, type JSONContent } from '@tiptap/core';
import { Paragraph } from '@tiptap/extension-paragraph';
import { newlineInCode, splitBlockKeepMarks } from '@tiptap/pm/commands';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import {
  EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useImperativeHandle, useLayoutEffect, useRef, type RefObject } from 'react';
import { usePromptFontStyle } from '@/features/settings/appearance/font-families';
import {
  buildDocJson, ComposerBlockExtensions, ComposerBoldExtension, ComposerCodeBlockExtension,
  ComposerCodeExtension, ComposerItalicExtension, ComposerListExtensions, ComposerStrikeExtension,
  ComposerTaskItemExtension, ComposerTaskListExtension, flatToMarkdown, flatToPm, markdownToFlat,
  moveOrderedListItems, pmToFlat, promptChipReplacements, serializeEditorDoc, serializedMarkdownOffset, serializeSelection,
  splitOrLiftListItem, stepCaretAcrossStyledEdge, surroundSelectionWithMark, type SkillMeta,
} from './HyperPromptDocument';
import {
  convertCodeFenceOnEnter, exitCodeBlockOnClosingFence, exitCodeBlockOnTrailingBlankLines,
  indentCodeBlock, indentedNewlineInCodeBlock, selectionInOneCodeBlock,
} from './HyperPromptCodeBlock';
import { CODE_BLOCK_LANGUAGES, codeLanguageEntry, languageOfInfoString, withInfoStringLanguage } from './HyperPromptCodeLanguages';
import { hyperPromptCodeHighlight } from './HyperPromptCodeHighlight';
import { caretLineDirection, ComposerTextDirectionExtension } from './HyperPromptDirection';
import { collapseShownMarkdownSource, ComposerMarkdownSourceExtension } from './HyperPromptMarkdownSource';
import { MARKDOWN_SOURCE_MARK } from './HyperPromptMarkdown';
import { COMPOSER_UNDO_GROUP_DELAY, groupUndoByChangeKind, markAsClipboardEdit, type ComposerChangeKind } from './HyperPromptUndo';
import { hasAncestor, hyperPromptBlockInputRules } from './HyperPromptInputRules';
import './HyperPromptEditor.css';

type HyperPromptRange = { start: number; end: number };
export type HyperPromptSelection = HyperPromptRange & { inCode: boolean };
export interface HyperPromptEditorHandle {
  readDraft: () => { text: string; selection: HyperPromptRange };
  focusAt: (start: number, end?: number) => void;
  replaceDraft: (text: string, caret: number) => void;
}

interface HyperPromptKey {
  key: string;
  shiftKey: boolean;
  nativeEvent: { isComposing?: boolean };
  preventDefault: () => void;
  stopPropagation: () => void;
}

interface HyperPromptEditorProps {
  value: string;
  'aria-label': string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  maxLength?: number;
  suggestionId?: string;
  activeSuggestionId?: string;
  editorRef?: RefObject<HyperPromptEditorHandle | null>;
  skills?: ReadonlyMap<string, SkillMeta>;
  onChange: (text: string, selection: HyperPromptSelection) => void;
  onKeyDown?: (event: HyperPromptKey, inList?: boolean) => void;
  onBlur?: () => void;
  onFiles?: (files: File[]) => void;
}

function HyperPromptChip({ node }: NodeViewProps) {
  const { path, skillName, skillLabel, skillDescription, kind, label, source } = node.attrs;
  const tone = path ? 'file' : skillName ? 'skill' : kind;
  const caption = path ? path.split(/[/\\]/).at(-1) : skillLabel || label;
  return <NodeViewWrapper as="span" className={'hyper-prompt-chip hyper-prompt-chip--' + tone} contentEditable={false} title={path || skillDescription || source} dir="auto">
    {tone !== 'person' && <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      {tone === 'file' ? <path d="M6 3h8l4 4v14H6zM14 3v5h4" /> : tone === 'skill' ? <path d="m12 2 2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" /> : <path d="m5 6 6 6-6 6m8 0h7" />}
    </svg>}
    <span>{caption}</span>
  </NodeViewWrapper>;
}

const chipAttributes = { path: null, skillName: null, skillLabel: null, skillDescription: null, kind: null, label: null, source: null };
const HyperPromptChipNode = Node.create({
  name: 'composer-mention',
  inline: true,
  group: 'inline',
  atom: true,
  addAttributes() {
    return Object.fromEntries(Object.entries(chipAttributes).map(([key, value]) => [key, { default: value }]));
  },
  renderHTML({ node }) { return ['span', {}, String(node.attrs.source ?? '')]; },
  addNodeView() { return ReactNodeViewRenderer(HyperPromptChip, { as: 'span' }); },
});

function HyperPromptCodeBlock({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const info = String(node.attrs.language ?? '');
  const language = languageOfInfoString(info);
  const selected = codeLanguageEntry(language)?.id ?? language;
  return <NodeViewWrapper className="hyper-prompt-code" dir="ltr">
    <div className="hyper-prompt-code-header" contentEditable={false}>
      <select aria-label="Code block language" value={selected} disabled={!editor.isEditable} onChange={event => {
        updateAttributes({ language: withInfoStringLanguage(info, event.currentTarget.value) });
        const position = getPos();
        if (typeof position === 'number') editor.chain().focus(position + 1 + node.content.size).run();
      }}>
        {selected && !codeLanguageEntry(language) && <option value={selected}>{language}</option>}
        {CODE_BLOCK_LANGUAGES.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
    </div>
    <pre><NodeViewContent<"code"> as="code" /></pre>
  </NodeViewWrapper>;
}

const HyperPromptUndo = Extension.create<{ }, { previous: ComposerChangeKind | null }>({
  name: 'hyperPromptUndoGrouping',
  addStorage() { return { previous: null }; },
  dispatchTransaction({ transaction, next }) {
    this.storage.previous = groupUndoByChangeKind(transaction, this.storage.previous);
    next(transaction);
  },
});

const SURROUND_CLOSE: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "'": "'",
  '"': '"',
  "“": "”",
  "`": "`",
  "<": ">",
  "«": "»",
  "*": "*",
  _: "_",
};

const extensions = [
  StarterKit.configure({
    paragraph: false, blockquote: false, bulletList: false, codeBlock: false, heading: false,
    horizontalRule: false, listItem: false, link: false, orderedList: false, underline: false,
    dropcursor: false, gapcursor: false, trailingNode: false, code: false, listKeymap: false,
    italic: false, bold: false, strike: false, undoRedo: { newGroupDelay: COMPOSER_UNDO_GROUP_DELAY },
  }),
  Paragraph.extend({ selectable: false }),
  HyperPromptUndo, ComposerTextDirectionExtension, ComposerMarkdownSourceExtension,
  HyperPromptChipNode, HyperPromptChipNode.extend({ name: 'composer-skill' }),
  HyperPromptChipNode.extend({ name: 'composer-reference' }),
  ComposerBoldExtension, ComposerItalicExtension, ComposerStrikeExtension, ComposerCodeExtension,
  ...hyperPromptBlockInputRules(ComposerBlockExtensions, ComposerListExtensions, ComposerTaskItemExtension),
  ComposerTaskListExtension,
  ComposerCodeBlockExtension.extend({
    addInputRules() { return []; },
    addNodeView() {
      return ReactNodeViewRenderer(HyperPromptCodeBlock, {
        stopEvent: ({ event }) => event.target instanceof Element && !!event.target.closest('.hyper-prompt-code-header'),
      });
    },
  }),
  hyperPromptCodeHighlight({
    resolveTheme: () => document.documentElement.dataset.theme === 'dark' ? 'github-dark' : 'github-light',
  }),
];

function readDraft(editor: Editor) {
  const map = serializeEditorDoc(editor.state.doc);
  const { from, to, $from } = editor.state.selection;
  return {
    text: map.value,
    selection: {
      start: flatToMarkdown(map, pmToFlat(map, from)),
      end: flatToMarkdown(map, pmToFlat(map, to)),
      inCode: Boolean($from.parent.type.spec.code || $from.marks().some(mark => mark.type.spec.code)),
    },
  };
}

function selectMarkdown(editor: Editor, text: string, start: number, end = start) {
  for (let pass = 0; pass < 2; pass += 1) {
    const map = serializeEditorDoc(editor.state.doc);
    const toPm = (offset: number) => flatToPm(map, markdownToFlat(map, serializedMarkdownOffset(text, map.value, offset)));
    editor.commands.setTextSelection({ from: toPm(start), to: toPm(end) });
  }
}

export function HyperPromptEditor(props: HyperPromptEditorProps) {
  const { value, disabled, editorRef, placeholder, className, suggestionId, activeSuggestionId } = props;
  const style = usePromptFontStyle();
  const latest = useRef(props);
  latest.current = props;
  const applying = useRef(false);
  const attributes = {
    class: 'hyper-prompt-editor',
    'data-testid': 'composer-editor',
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': props['aria-label'],
    ...(placeholder ? { 'aria-placeholder': placeholder, 'data-placeholder': placeholder } : {}),
    ...(disabled ? { 'aria-readonly': 'true' } : {}),
    ...(suggestionId ? { 'aria-autocomplete': 'list', 'aria-haspopup': 'listbox', 'aria-controls': suggestionId } : {}),
    ...(activeSuggestionId ? { 'aria-activedescendant': activeSuggestionId } : {}),
  };
  const skill = (name: string) => latest.current.skills?.get(name.toLowerCase()) ?? null;
  const content = (text: string) => buildDocJson(text, skill) as JSONContent;

  function replaceDraft(editor: Editor, text: string, caret: number, history: boolean, paste = false) {
    const doc = editor.schema.nodeFromJSON(content(text));
    applying.current = true;
    try {
      let tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content).setMeta('addToHistory', history);
      if (paste) tr = markAsClipboardEdit(tr, 'paste');
      editor.view.dispatch(tr);
      selectMarkdown(editor, text, caret);
    } finally {
      applying.current = false;
    }
    if (history) report(editor);
  }

  function report(editor: Editor) {
    if (applying.current || !editor.isInitialized || editor.view.composing) return;
    const { text, selection } = readDraft(editor);
    latest.current.onChange(text, selection);
  }

  const editor: Editor | null = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [...extensions, Extension.create({
      name: 'hyperPromptLength',
      addProseMirrorPlugins() {
        return [new Plugin({ filterTransaction: (tr, state) => {
          const max = latest.current.maxLength;
          if (!tr.docChanged || max === undefined) return true;
          const size = serializeEditorDoc(tr.doc).value.length;
          return size <= max || size <= serializeEditorDoc(state.doc).value.length;
        } })];
      },
    })],
    content: content(value),
    editable: !disabled,
    editorProps: {
      attributes,
      handleDOMEvents: {
        compositionend() {
          const instance = editor;
          if (instance) requestAnimationFrame(() => { if (!instance.isDestroyed) report(instance); });
          return false;
        },
      },
      clipboardTextSerializer: (_slice, view) => serializeSelection(view.state.doc, view.state.selection.from, view.state.selection.to),
      handleKeyDown(view, event) {
        if (view.composing || event.isComposing || event.keyCode === 229) return false;
        const instance = editor;
        const enter = event.key === 'Enter';
        const inCode = selectionInOneCodeBlock(view.state);
        const plainKey = !event.metaKey && !event.ctrlKey && !event.altKey;
        const dispatch = (tr: typeof view.state.tr) => view.dispatch(tr.scrollIntoView());
        if (plainKey && event.key === 'Tab' && inCode) {
          event.preventDefault();
          return indentCodeBlock(view.state, event.shiftKey ? 'out' : 'in', dispatch);
        }
        if (plainKey && enter) {
          if (inCode) {
            return exitCodeBlockOnClosingFence(view.state, dispatch) || exitCodeBlockOnTrailingBlankLines(view)
              || indentedNewlineInCodeBlock(view.state, dispatch) || newlineInCode(view.state, dispatch);
          }
          if (convertCodeFenceOnEnter(view.state, dispatch)) return true;
        }
        const inList = Boolean(instance?.isActive('taskItem') || instance?.isActive('listItem'));
        latest.current.onKeyDown?.({
          key: event.key, shiftKey: event.shiftKey, nativeEvent: event,
          preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation(),
        }, inList);
        if (event.defaultPrevented) return true;
        if (plainKey && event.key === 'Tab') {
          return moveOrderedListItems(view.state, event.shiftKey ? 'out' : 'in', dispatch);
        }
        if (plainKey && !event.shiftKey && view.state.selection.empty &&
            (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          const back = caretLineDirection(view.state) === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
          const direction = event.key === back ? -1 : 1;
          const step = stepCaretAcrossStyledEdge(view.state, direction);
          if (step) { dispatch(step); return true; }
          const { $from } = view.state.selection;
          const adjacent = direction === -1 ? $from.nodeBefore : $from.nodeAfter;
          if (adjacent?.type.name.startsWith('composer-')) {
            dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, $from.pos + direction * adjacent.nodeSize)));
            return true;
          }
        }
        if (plainKey && enter && instance) {
          const { $from } = view.state.selection;
          if (!$from.parent.content.size && hasAncestor($from, 'blockquote') && instance.commands.lift('blockquote')) return true;
          return (inList && splitOrLiftListItem(instance, collapseShownMarkdownSource)) ||
            instance.chain().command(collapseShownMarkdownSource)
              .command(({ state, dispatch: apply }) => splitBlockKeepMarks(state, apply)).scrollIntoView().run();
        }
        return false;
      },
      handleTextInput: (view, from, to, text) => {
        if (view.composing || text.length !== 1) return false;
        const closer = SURROUND_CLOSE[text];
        const { selection } = view.state;
        // Compose preedit updates replace a range even without a user selection.
        if (
          !closer ||
          !(selection instanceof TextSelection) ||
          selection.empty ||
          selection.from !== from ||
          selection.to !== to
        ) {
          return false;
        }
        // Do not wrap chips, atoms, or styled text; default replacement preserves marks.
        // Shown Markdown source is plain text, so typed delimiters wrap it.
        let touchesSpecial = false;
        view.state.doc.nodesBetween(from, to, (node) => {
          if (
            (node.isAtom && node.isInline && !node.isText) ||
            (node.isText && node.marks.some((mark) => mark.type.name !== MARKDOWN_SOURCE_MARK))
          ) {
            touchesSpecial = true;
            return false;
          }
          return true;
        });
        if (touchesSpecial) return false;
        const markTr = surroundSelectionWithMark(view.state, from, to, text);
        if (markTr) {
          view.dispatch(markTr);
          return true;
        }
        const tr = view.state.tr.insertText(closer, to).insertText(text, from);
        tr.setSelection(TextSelection.create(tr.doc, from + text.length, to + text.length));
        view.dispatch(tr);
        return true;
      },
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length && latest.current.onFiles) {
          latest.current.onFiles(files);
          return true;
        }
        const pasted = event.clipboardData?.getData('text/plain').replace(/\r\n?/g, '\n');
        if (!pasted || !editor) return false;
        const { text, selection } = readDraft(editor);
        const room = (latest.current.maxLength ?? Infinity) - text.length + selection.end - selection.start;
        const addition = pasted.slice(0, Math.max(0, room));
        if (addition && selection.inCode) {
          view.dispatch(markAsClipboardEdit(view.state.tr.insertText(addition), 'paste').scrollIntoView());
        } else if (addition) {
          replaceDraft(editor, text.slice(0, selection.start) + addition + text.slice(selection.end), selection.start + addition.length, true, true);
        }
        return true;
      },
    },
    onTransaction({ editor: instance, transaction }) {
      if (applying.current || !instance.isInitialized || instance.view.composing) return;
      if (!transaction.docChanged && !transaction.selectionSet) return;
      if (transaction.docChanged && instance.isEditable) {
        const edits = promptChipReplacements(instance.state.doc, skill);
        if (edits.length) {
          let tr = instance.state.tr;
          for (const edit of edits) tr = tr.replaceWith(edit.from, edit.to, edit.node);
          applying.current = true;
          try { instance.view.dispatch(tr.setMeta('addToHistory', false)); } finally { applying.current = false; }
        }
      }
      report(instance);
    },
    onFocus: ({ editor: instance }) => report(instance),
    onBlur: () => latest.current.onBlur?.(),
  });

  useLayoutEffect(() => {
    if (!editor) return;
    editor.view.setProps({ attributes });
    if (editor.isEditable === Boolean(disabled)) editor.setEditable(!disabled, false);
  });

  useLayoutEffect(() => {
    if (!editor) return;
    const draft = readDraft(editor);
    if (draft.text !== value) replaceDraft(editor, value, Math.min(draft.selection.start, value.length), false);
  }, [editor, value]);

  useLayoutEffect(() => {
    if (!editor) return;
    const edits = promptChipReplacements(editor.state.doc, skill);
    if (!edits.length) return;
    const tr = editor.state.tr;
    for (const edit of edits) tr.replaceWith(edit.from, edit.to, edit.node);
    applying.current = true;
    try { editor.view.dispatch(tr.setMeta('addToHistory', false)); } finally { applying.current = false; }
  }, [editor, props.skills]);

  useImperativeHandle<HyperPromptEditorHandle | null, HyperPromptEditorHandle | null>(editorRef, () => editor ? {
    readDraft: () => readDraft(editor),
    focusAt: (start, end) => {
      editor.view.focus();
      selectMarkdown(editor, latest.current.value, start, end);
      editor.view.dispatch(editor.state.tr.scrollIntoView());
    },
    replaceDraft: (text, caret) => {
      editor.view.focus();
      replaceDraft(editor, text, caret, true);
    },
  } : null, [editor]);

  return <div className={className ? 'hyper-prompt-field ' + className : 'hyper-prompt-field'} style={style}>
    {editor ? <EditorContent editor={editor} /> : <textarea
      data-testid="composer-editor" aria-label={props['aria-label']} placeholder={placeholder}
      value={value} rows={1} readOnly={disabled} maxLength={props.maxLength}
      onChange={event => props.onChange(event.currentTarget.value, {
        start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd, inCode: false,
      })}
      onKeyDown={event => props.onKeyDown?.(event)}
    />}
  </div>;
}
