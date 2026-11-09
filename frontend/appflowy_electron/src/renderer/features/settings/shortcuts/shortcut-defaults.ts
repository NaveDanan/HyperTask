// The editor's command shortcuts as the settings page lists them (79 entries): the app's
// `commandShortcutEvents` (plugins/document/presentation/editor_plugins/shortcuts/command_shortcuts.dart)
// with the commands of appflowy_editor 470c4e7 / appflowy_editor_plugins 4efcff7.
// `command` is the Windows/Linux binding (no command here sets windowsCommand/linuxCommand);
// `macOSCommand` is set only where it differs.

export interface ShortcutDefinition {
  /** CommandShortcutEvent.key: the persisted id. */
  key: string;
  command: string;
  macOSCommand?: string;
  /** Part of localizedCodeBlockCommands: conflicts are only checked among code-block commands. */
  isCodeBlock?: boolean;
  /** `settings.shortcutsPage.keybindings.<labelKey>` (CommandLabel.afLabel). */
  labelKey?: string;
  /** description?.capitalize(), used when no label key matches. */
  description?: string;
}

const kb = (labelKey: string) => ({ labelKey });
const desc = (description: string) => ({ description });

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { key: 'Align text to the center', command: 'ctrl+shift+c', ...kb('alignCenter') },
  { key: 'Align text to the left', command: 'ctrl+shift+l', ...kb('alignLeft') },
  { key: 'Align text to the right', command: 'ctrl+shift+r', ...kb('alignRight') },
  { key: 'arrow left to title', command: 'arrow left', ...desc('Arrow left to title') },
  { key: 'arrow up to title', command: 'arrow up', ...desc('Arrow up to title') },
  { key: 'backspace', command: 'backspace, shift+backspace', ...kb('backspace') },
  { key: 'backspace to title', command: 'backspace', ...desc('Backspace to title') },
  { key: 'convert to paragraph', command: 'backspace', ...kb('convertToParagraph') },
  { key: 'copy the selected content', command: 'ctrl+c', macOSCommand: 'cmd+c', ...kb('copy') },
  {
    key: 'ctrl + a to select all content inside a code block',
    command: 'ctrl+a',
    macOSCommand: 'meta+a',
    isCodeBlock: true,
    ...kb('selectAllCodeblock'),
  },
  { key: 'Ctrl + Alt + E to show emoji picker', command: 'ctrl+alt+e', macOSCommand: 'cmd+alt+e', ...kb('showEmojiPicker') },
  { key: 'cut the selected content', command: 'ctrl+x', macOSCommand: 'cmd+x', ...kb('cut') },
  // deleteCommand.key: the label is keybindings.deleteMacOS on macOS (see shortcutLabel).
  { key: 'Delete Key', command: 'delete, shift+delete', ...kb('delete') },
  { key: 'delete the left line', command: 'ctrl+alt+backspace', macOSCommand: 'cmd+backspace', ...kb('deleteLeftSentence') },
  { key: 'delete the left word', command: 'ctrl+backspace', macOSCommand: 'alt+backspace', ...kb('deleteLeftWord') },
  { key: 'delete the right word', command: 'ctrl+delete', macOSCommand: 'alt+delete', ...kb('deleteRightWord') },
  { key: 'exit the editing mode', command: 'escape', ...kb('exit') },
  { key: 'indent', command: 'tab', ...kb('indent') },
  {
    key: 'insert a new paragraph next to the code block',
    command: 'shift+enter',
    isCodeBlock: true,
    ...kb('insertNewParagraphInCodeblock'),
  },
  { key: 'Insert inline math equation', command: 'ctrl+shift+e', macOSCommand: 'cmd+shift+e', ...kb('insertInlineMathEquation') },
  { key: 'link menu', command: 'ctrl+k', macOSCommand: 'cmd+k', ...kb('showLinkMenu') },
  { key: 'move cursor down and select one line', command: 'shift+arrow down', ...kb('moveCursorDownSelect') },
  { key: 'move cursor to end of file', command: 'ctrl+arrow down', macOSCommand: 'cmd+arrow down', ...kb('moveCursorBottom') },
  {
    key: 'move cursor to end of file and select all',
    command: 'ctrl+shift+arrow down',
    macOSCommand: 'cmd+shift+arrow down',
    ...kb('moveCursorBottomSelect'),
  },
  { key: 'move cursor to select till end of line', command: 'shift+end', macOSCommand: 'cmd+shift+arrow right', ...kb('moveCursorEndSelect') },
  {
    key: 'move cursor to select till start of line',
    command: 'shift+home',
    macOSCommand: 'cmd+shift+arrow left',
    ...kb('moveCursorBeginSelect'),
  },
  { key: 'move cursor to start of file', command: 'ctrl+arrow up', macOSCommand: 'cmd+arrow up', ...kb('moveCursorTop') },
  {
    key: 'move cursor to start of file and select all',
    command: 'ctrl+shift+arrow up',
    macOSCommand: 'cmd+shift+arrow up',
    ...kb('moveCursorTopSelect'),
  },
  { key: 'move cursor up and select one line', command: 'shift+arrow up', ...kb('moveCursorUpSelect') },
  { key: 'move the cursor at the start of line', command: 'home', macOSCommand: 'cmd+arrow left', ...kb('moveCursorBeginning') },
  { key: 'move the cursor backward one character', command: 'arrow left', ...kb('moveCursorLeft') },
  { key: 'move the cursor downward', command: 'arrow down', ...kb('moveCursorDown') },
  { key: 'move the cursor forward one character', command: 'arrow right', ...kb('moveCursorRight') },
  { key: 'move the cursor left select', command: 'shift+arrow left', ...kb('moveCursorLeftSelect') },
  { key: 'move the cursor right select', command: 'shift+arrow right', ...kb('moveCursorRightSelect') },
  {
    key: 'move the cursor to select the left word',
    command: 'ctrl+shift+arrow left',
    macOSCommand: 'alt+shift+arrow left',
    ...kb('moveCursorLeftWordSelect'),
  },
  {
    key: 'move the cursor to select the right word',
    command: 'ctrl+shift+arrow right',
    macOSCommand: 'alt+shift+arrow right',
    ...kb('moveCursorRightWordSelect'),
  },
  { key: 'move the cursor to the end of line', command: 'end', macOSCommand: 'cmd+arrow right', ...kb('moveCursorEnd') },
  { key: 'move the cursor to the left word', command: 'ctrl+arrow left', macOSCommand: 'alt+arrow left', ...kb('moveCursorLeftWord') },
  { key: 'move the cursor to the right word', command: 'ctrl+arrow right', macOSCommand: 'alt+arrow right', ...kb('moveCursorRightWord') },
  { key: 'move the cursor upward', command: 'arrow up', ...kb('moveCursorUp') },
  { key: 'open inline link', command: 'alt+enter', ...kb('openInlineLink') },
  { key: 'open links', command: 'alt+shift+enter', ...kb('openLinks') },
  { key: 'outdent', command: 'shift+tab', ...kb('outdent') },
  { key: 'paste in codeblock', command: 'ctrl+v', macOSCommand: 'cmd+v', isCodeBlock: true, ...kb('pasteInCodeblock') },
  { key: 'paste the content', command: 'ctrl+v', macOSCommand: 'cmd+v', ...kb('paste') },
  { key: 'paste the plain content', command: 'ctrl+shift+v', macOSCommand: 'cmd+shift+v', ...desc('Paste content') },
  { key: 'Press arrow down in table cell', command: 'arrow down', ...desc('Move to down cell at same offset') },
  { key: 'Press arrow left in table cell', command: 'arrow left', ...desc('Move to right cell if its at the end of current cell') },
  { key: 'Press arrow right in table cell', command: 'arrow right', ...desc('Move to right cell if its at the end of current cell') },
  { key: 'Press arrow up in table cell', command: 'arrow up', ...desc('Move to up cell at same offset') },
  { key: 'Press backspace in table cell', command: 'backspace', ...desc('Ignore the backspace key in table cell') },
  { key: 'Press enter in table cell', command: 'enter', ...desc('Press the enter key in table cell') },
  { key: 'Press shift + tab in table cell', command: 'shift+tab', ...desc('Move the selection to the previous cell') },
  { key: 'Press tab in table cell', command: 'tab', ...desc('Move the selection to the next cell') },
  { key: 'redo', command: 'ctrl+y,ctrl+shift+z', macOSCommand: 'cmd+shift+z', ...kb('redo') },
  { key: 'remove toggle heading style', command: 'backspace', ...desc('Remove toggle heading style') },
  { key: 'scroll one page down', command: 'page down', ...kb('pageDown') },
  { key: 'scroll one page up', command: 'page up', ...kb('pageUp') },
  { key: 'scroll to the bottom of the document', command: 'ctrl+end', macOSCommand: 'end', ...kb('end') },
  { key: 'scroll to the top of the document', command: 'ctrl+home', macOSCommand: 'home', ...kb('home') },
  { key: 'Select all contents in table cell', command: 'ctrl+a', macOSCommand: 'cmd+a', ...desc('Select all contents in table cell') },
  { key: 'select all the selectable content', command: 'ctrl+a', macOSCommand: 'cmd+a', ...kb('selectAll') },
  {
    key: 'shift + tab to delete two spaces at the line start in code block',
    command: 'shift+tab',
    isCodeBlock: true,
    ...kb('outdentLineCodeblock'),
  },
  {
    key: 'tab to insert two spaces at the cursor in code block',
    command: 'tab',
    isCodeBlock: true,
    ...kb('twoSpacesCursorCodeblock'),
  },
  {
    key: 'tab to insert two spaces at the line start in code block',
    command: 'tab',
    isCodeBlock: true,
    ...kb('indentLineCodeblock'),
  },
  { key: 'table navigation', command: 'arrow down', ...desc('Table navigation') },
  { key: 'toggle Body', command: 'ctrl+shift+b', macOSCommand: 'cmd+shift+b', ...desc('Toggle body') },
  { key: 'toggle bold', command: 'ctrl+b', macOSCommand: 'cmd+b', ...kb('toggleBold') },
  { key: 'toggle code', command: 'ctrl+e', macOSCommand: 'cmd+e', ...kb('toggleCode') },
  { key: 'toggle highlight', command: 'ctrl+shift+h', macOSCommand: 'cmd+shift+h', ...kb('toggleHighlight') },
  { key: 'toggle into Heading 1', command: 'ctrl+shift+t', macOSCommand: 'cmd+shift+t', ...desc('Toggle H1') },
  { key: 'toggle into Heading 2', command: 'ctrl+shift+g', macOSCommand: 'cmd+shift+g', ...desc('Toggle H2') },
  { key: 'toggle into Heading 3', command: 'ctrl+shift+j', macOSCommand: 'cmd+shift+j', ...desc('Toggle H3') },
  { key: 'toggle italic', command: 'ctrl+i', macOSCommand: 'cmd+i', ...kb('toggleItalic') },
  { key: 'toggle strikethrough', command: 'ctrl+shift+s', macOSCommand: 'cmd+shift+s', ...kb('toggleStrikethrough') },
  { key: 'toggle the toggle list', command: 'ctrl+enter', macOSCommand: 'cmd+enter', ...kb('toggleToDoList') },
  { key: 'toggle underline', command: 'ctrl+u', macOSCommand: 'cmd+u', ...kb('toggleUnderline') },
  { key: 'undo', command: 'ctrl+z', macOSCommand: 'cmd+z', ...kb('undo') },
];

export const isMacOS = () => typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

/** CommandShortcutEvent's constructor: the platform command (macOSCommand on macOS when set). */
export const platformCommand = (definition: ShortcutDefinition, mac = isMacOS()) =>
  mac && definition.macOSCommand ? definition.macOSCommand : definition.command;
