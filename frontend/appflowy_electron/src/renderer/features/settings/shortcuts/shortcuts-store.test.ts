import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n', () => ({ tr: (key: string) => key }));
vi.mock('@/startup/app-store', () => ({
  useAppStore: { getState: () => ({ dataDirectory: 'C:\\data', info: { platform: 'win32' } }) },
}));

const files = new Map<string, string>();
const fs = {
  readText: vi.fn(async (path: string) => files.get(path) ?? null),
  writeText: vi.fn(async (path: string, content: string) => void files.set(path, content)),
};
(globalThis as unknown as { window: unknown }).window = { appflowy: { fs } };

const { SHORTCUT_DEFINITIONS, platformCommand } = await import('./shortcut-defaults');
const store = await import('./shortcuts-store');
const {
  CommandShortcutEvent,
  commandShortcutEvents,
  decodeShortcuts,
  encodeShortcuts,
  keyEventToCommand,
  keybindingParts,
  parseKeybinding,
  shortcutLabel,
  shortcutsActions,
  shortcutsFilePath,
  useShortcutsStore,
} = store;

const FILE = 'C:\\data\\shortcuts\\shortcuts.json';
const find = (key: string) => commandShortcutEvents.find((e) => e.key === key)!;

function resetLiveCommands() {
  for (const event of commandShortcutEvents) {
    event.clearCommand();
    event.updateCommand(platformCommand(event.definition, false));
  }
}

describe('shortcut defaults', () => {
  it('lists the 79 commands with unique keys', () => {
    expect(SHORTCUT_DEFINITIONS).toHaveLength(79);
    expect(new Set(SHORTCUT_DEFINITIONS.map((d) => d.key.toLowerCase())).size).toBe(79);
    expect(SHORTCUT_DEFINITIONS.filter((d) => d.isCodeBlock)).toHaveLength(6);
  });

  it('labels from keybindings keys, else the capitalized description', () => {
    expect(shortcutLabel(find('toggle bold'), false)).toBe('settings.shortcutsPage.keybindings.toggleBold');
    expect(shortcutLabel(find('Delete Key'), false)).toBe('settings.shortcutsPage.keybindings.delete');
    expect(shortcutLabel(find('Delete Key'), true)).toBe('settings.shortcutsPage.keybindings.deleteMacOS');
    expect(shortcutLabel(find('table navigation'), false)).toBe('Table navigation');
  });

  it('uses the macOS command only on macOS', () => {
    const copy = SHORTCUT_DEFINITIONS.find((d) => d.key === 'copy the selected content')!;
    expect(platformCommand(copy, false)).toBe('ctrl+c');
    expect(platformCommand(copy, true)).toBe('cmd+c');
  });
});

describe('Keybinding.parse', () => {
  it('parses modifiers in any order and keeps the key label', () => {
    expect(keybindingParts(parseKeybinding('Ctrl+Shift+Arrow Down'))).toEqual(['ctrl', 'shift', 'arrow down']);
    expect(keybindingParts(parseKeybinding(' shift+backspace'))).toEqual(['shift', 'backspace']);
    expect(keybindingParts(parseKeybinding('cmd+alt+e'))).toEqual(['meta', 'alt', 'e']);
    expect(keybindingParts(parseKeybinding('alt-shift-enter'))).toEqual(['shift', 'alt', 'enter']);
  });

  it('updateCommand ignores an empty command; clearCommand empties it', () => {
    const event = new CommandShortcutEvent({ key: 'k', command: 'ctrl+b' });
    event.updateCommand('');
    expect(event.command).toBe('ctrl+b');
    event.clearCommand();
    expect(event.command).toBe('');
    expect(event.keybindings).toEqual([]);
  });
});

describe('key capture (ToCommand)', () => {
  const ev = (init: Partial<KeyboardEvent>) =>
    ({ key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init }) as KeyboardEvent;

  it('prefixes ctrl, meta, shift, alt in that order', () => {
    expect(keyEventToCommand(ev({ key: 'B', code: 'KeyB', ctrlKey: true, shiftKey: true, altKey: true, metaKey: true }))).toBe(
      'ctrl+meta+shift+alt+b',
    );
  });

  it('a pure modifier press gives only the prefix', () => {
    expect(keyEventToCommand(ev({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBe('ctrl+');
    expect(keyEventToCommand(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBe('shift+');
  });

  it('names keys as the editor keyToCodeMapping', () => {
    expect(keyEventToCommand(ev({ key: 'ArrowLeft', code: 'ArrowLeft' }))).toBe('arrow left');
    expect(keyEventToCommand(ev({ key: '!', code: 'Digit1', shiftKey: true }))).toBe('shift+digit 1');
    expect(keyEventToCommand(ev({ key: 'PageUp', code: 'PageUp' }))).toBe('page up');
    expect(keyEventToCommand(ev({ key: 'Enter', code: 'Enter', shiftKey: true }))).toBe('shift+enter');
    expect(keyEventToCommand(ev({ key: 'F5', code: 'F5' }))).toBe('f5');
    expect(keyEventToCommand(ev({ key: 'Unknown', code: 'Lang9' }))).toBe('');
  });
});

describe('shortcuts.json', () => {
  it('encodes all shortcuts compactly, like jsonEncode', () => {
    expect(encodeShortcuts([{ key: 'undo', command: 'ctrl+z' }])).toBe('{"commandShortcuts":[{"key":"undo","command":"ctrl+z"}]}');
    expect(decodeShortcuts('{"commandShortcuts":[{"key":"undo"}]}')).toEqual([{ key: 'undo', command: '' }]);
    expect(() => decodeShortcuts('{}')).toThrow();
  });

  it('lives in <data>/shortcuts/shortcuts.json', () => {
    expect(shortcutsFilePath()).toBe(FILE);
  });
});

describe('ShortcutsCubit', () => {
  beforeEach(() => {
    files.clear();
    fs.writeText.mockClear();
    resetLiveCommands();
    shortcutsActions.reset();
  });

  it('creates an empty file when missing and sorts by lower-cased key', async () => {
    await shortcutsActions.fetchShortcuts();
    expect(files.get(FILE)).toBe('');
    const { status, commandShortcutEvents: list } = useShortcutsStore.getState();
    expect(status).toBe('success');
    expect(list).toHaveLength(79);
    const keys = list.map((e) => e.key.toLowerCase());
    expect(keys).toEqual([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(list[0].key).toBe('Align text to the center');
    expect(list.at(-1)!.key).toBe('undo');
  });

  it('applies saved commands to the first live shortcut with that key', async () => {
    files.set(FILE, encodeShortcuts([{ key: 'toggle bold', command: 'ctrl+shift+b' }, { key: 'undo', command: '' }]));
    await shortcutsActions.fetchShortcuts();
    expect(find('toggle bold').command).toBe('ctrl+shift+b');
    // A saved empty command does not clear anything (updateCommand ignores it).
    expect(find('undo').command).toBe('ctrl+z');
  });

  it('fails with the load error on a malformed file', async () => {
    files.set(FILE, 'not json');
    await shortcutsActions.fetchShortcuts();
    expect(useShortcutsStore.getState()).toMatchObject({ status: 'failure', error: 'settings.shortcutsPage.couldNotLoadErrorMsg' });
  });

  it('saves every shortcut and round-trips', async () => {
    await shortcutsActions.fetchShortcuts();
    find('toggle italic').updateCommand('ctrl+shift+i');
    await shortcutsActions.updateAllShortcuts();
    const saved = decodeShortcuts(files.get(FILE)!);
    expect(saved).toHaveLength(79);
    expect(saved.find((s) => s.key === 'toggle italic')!.command).toBe('ctrl+shift+i');
    resetLiveCommands();
    await shortcutsActions.fetchShortcuts();
    expect(find('toggle italic').command).toBe('ctrl+shift+i');
  });

  it('resetToDefault writes the defaults and reloads', async () => {
    await shortcutsActions.fetchShortcuts();
    find('toggle code').clearCommand();
    find('undo').updateCommand('ctrl+u');
    await shortcutsActions.resetToDefault();
    expect(find('toggle code').command).toBe('ctrl+e');
    expect(find('undo').command).toBe('ctrl+z');
    expect(useShortcutsStore.getState().status).toBe('success');
  });

  describe('getConflict', () => {
    beforeEach(async () => {
      await shortcutsActions.fetchShortcuts();
    });

    it('finds the first shortcut of the same kind using the binding', () => {
      expect(shortcutsActions.getConflict(find('toggle italic'), 'ctrl+b')?.key).toBe('toggle bold');
      expect(shortcutsActions.getConflict(find('toggle italic'), 'ctrl+shift+q')).toBeNull();
    });

    it('keeps code-block and other commands apart', () => {
      // 'paste in codeblock' and 'paste the content' both use ctrl+v.
      expect(shortcutsActions.getConflict(find('paste in codeblock'), 'ctrl+v')?.key).toBe('paste in codeblock');
      expect(shortcutsActions.getConflict(find('toggle bold'), 'ctrl+v')?.key).toBe('paste the content');
      expect(shortcutsActions.getConflict(find('paste in codeblock'), 'ctrl+b')).toBeNull();
    });

    it('never matches entries after ", " (no trimming)', () => {
      expect(shortcutsActions.getConflict(find('toggle bold'), 'shift+backspace')).toBeNull();
      expect(shortcutsActions.getConflict(find('toggle bold'), ' shift+backspace')?.key).toBe('backspace');
    });

    it('can match the edited shortcut itself when it has several bindings', () => {
      expect(shortcutsActions.getConflict(find('redo'), 'ctrl+y')?.key).toBe('redo');
    });
  });
});
