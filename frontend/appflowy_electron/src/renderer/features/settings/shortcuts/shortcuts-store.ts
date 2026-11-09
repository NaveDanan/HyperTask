import { create } from 'zustand';
import { tr } from '@/i18n';
import { useAppStore } from '@/startup/app-store';
import { SHORTCUT_DEFINITIONS, isMacOS, platformCommand, type ShortcutDefinition } from './shortcut-defaults';

// ShortcutsCubit (workspace/application/settings/shortcuts/settings_shortcuts_cubit.dart),
// SettingsShortcutService (settings_shortcuts_service.dart) and the shortcuts.json model
// (shortcuts_model.dart), over appflowy_editor's CommandShortcutEvent/Keybinding.

/** Keybinding.parse (appflowy_editor service/shortcut_event/keybinding.dart). */
export interface Keybinding {
  isAltPressed: boolean;
  isControlPressed: boolean;
  isMetaPressed: boolean;
  isShiftPressed: boolean;
  keyLabel: string;
}

export function parseKeybinding(input: string): Keybinding {
  let command = input.toLowerCase().trim();
  const binding: Keybinding = { isAltPressed: false, isControlPressed: false, isMetaPressed: false, isShiftPressed: false, keyLabel: '' };
  let matched: boolean;
  do {
    matched = false;
    if (/^alt(\+|-)/.test(command)) {
      binding.isAltPressed = true;
      command = command.substring(4);
      matched = true;
    }
    if (/^ctrl(\+|-)/.test(command)) {
      binding.isControlPressed = true;
      command = command.substring(5);
      matched = true;
    }
    if (/^shift(\+|-)/.test(command)) {
      binding.isShiftPressed = true;
      command = command.substring(6);
      matched = true;
    }
    if (/^meta(\+|-)/.test(command)) {
      binding.isMetaPressed = true;
      command = command.substring(5);
      matched = true;
    }
    if (/^cmd(\+|-)/.test(command) || /^win(\+|-)/.test(command)) {
      binding.isMetaPressed = true;
      command = command.substring(4);
      matched = true;
    }
  } while (matched);
  binding.keyLabel = command;
  return binding;
}

/** ShortcutSettingTile._toParts: ctrl, meta, shift, alt, then the key label. */
export function keybindingParts(binding: Keybinding): string[] {
  const keys: string[] = [];
  if (binding.isControlPressed) keys.push('ctrl');
  if (binding.isMetaPressed) keys.push('meta');
  if (binding.isShiftPressed) keys.push('shift');
  if (binding.isAltPressed) keys.push('alt');
  keys.push(binding.keyLabel);
  return keys;
}

/** CommandShortcutEvent: a mutable command shared by the editor and the settings page. */
export class CommandShortcutEvent {
  readonly key: string;
  readonly definition: ShortcutDefinition;
  command = '';
  keybindings: Keybinding[] = [];

  constructor(definition: ShortcutDefinition, command = platformCommand(definition)) {
    this.key = definition.key;
    this.definition = definition;
    this.updateCommand(command);
  }

  get isCodeBlockCommand(): boolean {
    return this.definition.isCodeBlock === true;
  }

  /** updateCommand(command:): an empty command is ignored, as in the editor. */
  updateCommand(command: string | null | undefined) {
    if (!command) return;
    this.command = command;
    this.keybindings = command.split(',').map(parseKeybinding);
  }

  /** clearCommand: no keybindings and an empty command until updated again. */
  clearCommand() {
    this.keybindings = [];
    this.command = '';
  }
}

/** CommandLabel.afLabel: the localized label, else the capitalized description, else ''. */
export function shortcutLabel(event: CommandShortcutEvent, mac = isMacOS()): string {
  const { labelKey, description } = event.definition;
  if (labelKey) return tr(`settings.shortcutsPage.keybindings.${labelKey === 'delete' && mac ? 'deleteMacOS' : labelKey}`);
  if (description) return description.charAt(0).toUpperCase() + description.slice(1);
  return '';
}

/** `commandShortcutEvents`: the live, app-wide list the editor reads. Sorted in place by fetchShortcuts. */
export const commandShortcutEvents: CommandShortcutEvent[] = SHORTCUT_DEFINITIONS.map((d) => new CommandShortcutEvent(d));

/**
 * `defaultCommandShortcutEvents`: copies of the defaults. Dart captures them lazily on first
 * access (normally before any customization is applied); here they always come from the definitions.
 */
export const defaultCommandShortcutEvents = (): CommandShortcutEvent[] => SHORTCUT_DEFINITIONS.map((d) => new CommandShortcutEvent(d));

export interface CommandShortcutModel {
  key: string;
  command: string;
}

/** `<ApplicationDataStorage path>/shortcuts/shortcuts.json`. */
export function shortcutsFilePath(): string {
  const { dataDirectory, info } = useAppStore.getState();
  const sep = info?.platform === 'win32' ? '\\' : '/';
  return [dataDirectory, 'shortcuts', 'shortcuts.json'].join(sep);
}

/** EditorShortcuts.toJson, encoded like Dart's jsonEncode (compact). */
export function encodeShortcuts(shortcuts: Array<{ key: string; command: string }>): string {
  return JSON.stringify({ commandShortcuts: shortcuts.map((s) => ({ key: s.key, command: s.command })) });
}

/** EditorShortcuts.fromJson: throws on a malformed document, as the Dart casts do. */
export function decodeShortcuts(json: string): CommandShortcutModel[] {
  const parsed = JSON.parse(json) as { commandShortcuts?: unknown };
  const list = parsed?.commandShortcuts;
  if (!Array.isArray(list)) throw new Error('commandShortcuts is not a list');
  return list.map((item: { key?: unknown; command?: unknown }) => {
    const command = item?.command ?? '';
    if (typeof item?.key !== 'string' || typeof command !== 'string') throw new Error('Invalid shortcut entry');
    return { key: item.key, command };
  });
}

export const shortcutsService = {
  /** saveAllShortcuts: writes every shortcut, not only the changed ones. */
  async saveAllShortcuts(shortcuts: CommandShortcutEvent[]): Promise<void> {
    await window.appflowy.fs.writeText(shortcutsFilePath(), encodeShortcuts(shortcuts));
  },
  /** getCustomizeShortcuts: the file is created empty when missing; empty → no customizations. */
  async getCustomizeShortcuts(): Promise<CommandShortcutModel[]> {
    const path = shortcutsFilePath();
    const text = await window.appflowy.fs.readText(path);
    if (text === null) {
      await window.appflowy.fs.writeText(path, '');
      return [];
    }
    return text === '' ? [] : decodeShortcuts(text);
  },
  /** updateCommandShortcuts: first live shortcut with the same key and a different command. */
  updateCommandShortcuts(commandShortcuts: CommandShortcutEvent[], customizeShortcuts: CommandShortcutModel[]) {
    for (const shortcut of customizeShortcuts) {
      commandShortcuts.find((s) => s.key === shortcut.key && s.command !== shortcut.command)?.updateCommand(shortcut.command);
    }
  },
};

export type ShortcutsStatus = 'initial' | 'updating' | 'success' | 'failure';
export const isShortcutsLoading = (status: ShortcutsStatus) => status === 'initial' || status === 'updating';

interface ShortcutsState {
  commandShortcutEvents: CommandShortcutEvent[];
  status: ShortcutsStatus;
  error: string;
}

export const useShortcutsStore = create<ShortcutsState>(() => ({ commandShortcutEvents: [], status: 'initial', error: '' }));

/** Dart String.compareTo: UTF-16 code unit order. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const shortcutsActions = {
  /** A new ShortcutsCubit (the page creates one each time it is built). */
  reset() {
    useShortcutsStore.setState({ commandShortcutEvents: [], status: 'initial', error: '' });
  },

  async fetchShortcuts(): Promise<void> {
    useShortcutsStore.setState({ status: 'updating', error: '' });
    try {
      const customizeShortcuts = await shortcutsService.getCustomizeShortcuts();
      shortcutsService.updateCommandShortcuts(commandShortcutEvents, customizeShortcuts);
      commandShortcutEvents.sort((a, b) => compare(a.key.toLowerCase(), b.key.toLowerCase()));
      useShortcutsStore.setState({ status: 'success', commandShortcutEvents: [...commandShortcutEvents], error: '' });
    } catch {
      useShortcutsStore.setState({ status: 'failure', error: tr('settings.shortcutsPage.couldNotLoadErrorMsg') });
    }
  },

  async updateAllShortcuts(): Promise<void> {
    useShortcutsStore.setState({ status: 'updating', error: '' });
    try {
      await shortcutsService.saveAllShortcuts(useShortcutsStore.getState().commandShortcutEvents);
      useShortcutsStore.setState((s) => ({ status: 'success', error: '', commandShortcutEvents: [...s.commandShortcutEvents] }));
    } catch {
      useShortcutsStore.setState({ status: 'failure', error: tr('settings.shortcutsPage.couldNotSaveErrorMsg') });
    }
  },

  async resetToDefault(): Promise<void> {
    useShortcutsStore.setState({ status: 'updating', error: '' });
    try {
      await shortcutsService.saveAllShortcuts(defaultCommandShortcutEvents());
      await shortcutsActions.fetchShortcuts();
    } catch {
      useShortcutsStore.setState({ status: 'failure', error: tr('settings.shortcutsPage.couldNotSaveErrorMsg') });
    }
  },

  /**
   * getConflict: the first shortcut whose comma-separated bindings (not trimmed, so entries
   * after ", " never match) contain `command`, among shortcuts of the same code-block kind.
   * It can be the edited shortcut itself when it has several bindings.
   */
  getConflict(currentShortcut: CommandShortcutEvent, command: string): CommandShortcutEvent | null {
    const isCodeBlockCommand = currentShortcut.isCodeBlockCommand;
    for (const shortcut of useShortcutsStore.getState().commandShortcutEvents) {
      if (shortcut.command.split(',').includes(command) && shortcut.isCodeBlockCommand === isCodeBlockCommand) return shortcut;
    }
    return null;
  },
};

// ---- Key capture (ToCommand on KeyEvent) ----

const CODE_NAMES: Record<string, string> = {
  Space: 'space',
  Minus: 'minus',
  Equal: 'equal',
  BracketLeft: 'bracket left',
  BracketRight: 'bracket right',
  Backslash: 'backslash',
  Semicolon: 'semicolon',
  Quote: 'quote single',
  Backquote: 'backquote',
  Comma: 'comma',
  Period: 'period',
  Slash: 'slash',
  IntlBackslash: 'intl backslash',
  IntlRo: 'intl ro',
  IntlYen: 'intl yen',
  Backspace: 'backspace',
  Tab: 'tab',
  Enter: 'enter',
  Escape: 'escape',
  Delete: 'delete',
  Insert: 'insert',
  ArrowDown: 'arrow down',
  ArrowLeft: 'arrow left',
  ArrowRight: 'arrow right',
  ArrowUp: 'arrow up',
  End: 'end',
  Home: 'home',
  PageDown: 'page down',
  PageUp: 'page up',
  CapsLock: 'caps lock',
  NumLock: 'num lock',
  ScrollLock: 'scroll lock',
  ContextMenu: 'context menu',
  Pause: 'pause',
  PrintScreen: 'print screen',
  NumpadEnter: 'numpad enter',
  NumpadMultiply: 'numpad multiply',
  NumpadAdd: 'numpad add',
  NumpadComma: 'numpad comma',
  NumpadSubtract: 'numpad subtract',
  NumpadDecimal: 'numpad decimal',
  NumpadDivide: 'numpad divide',
  NumpadEqual: 'numpad equal',
  NumpadParenLeft: 'numpad paren left',
  NumpadParenRight: 'numpad paren right',
  AudioVolumeDown: 'audio volume down',
  AudioVolumeUp: 'audio volume up',
  AudioVolumeMute: 'audio volume mute',
  MediaPlayPause: 'media play pause',
  MediaStop: 'media stop',
  MediaTrackNext: 'media track next',
  MediaTrackPrevious: 'media track previous',
};

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS']);

/** The editor keyToCodeMapping name of a key (lower case), or '' when unmapped. */
export function keyName(event: Pick<KeyboardEvent, 'key' | 'code'>): string {
  // Letters follow the keyboard layout, as Flutter's logical keys do.
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(event.code)) return `digit ${event.code.slice(5)}`;
  if (/^Numpad[0-9]$/.test(event.code)) return `numpad ${event.code.slice(6)}`;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) return event.code.toLowerCase();
  return CODE_NAMES[event.code] ?? '';
}

/** ToCommand.toCommand: `ctrl+`/`meta+`/`shift+`/`alt+` (pressed modifiers) + key name. */
export function keyEventToCommand(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): string {
  let command = '';
  if (event.ctrlKey) command += 'ctrl+';
  if (event.metaKey) command += 'meta+';
  if (event.shiftKey) command += 'shift+';
  if (event.altKey) command += 'alt+';
  if (MODIFIER_KEYS.has(event.key)) return command;
  return command + keyName(event);
}
