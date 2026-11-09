import { useEffect, useRef, useState } from 'react';
import { Search, RotateCcw, PencilLine, X } from 'lucide-react';
import { SettingsPageHeader, SettingsSection, SettingsGroup, SettingsRow } from '@/components/app/settings-layout';
import { ShortcutKeys } from '@/components/app/shortcut';
import { Kbd } from '@/components/ui/kbd';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { platformCommand } from './shortcut-defaults';
import { useTr } from '@/i18n';
import { Tooltip, showConfirmDialog, showDialog } from '@/ui';
import type { SettingsPageProps } from '../page-props';
import { SettingsAlertDialog } from '../shared-widgets';
import {
  isShortcutsLoading,
  keyEventToCommand,
  keybindingParts,
  shortcutLabel,
  shortcutsActions,
  useShortcutsStore,
  type CommandShortcutEvent,
} from './shortcuts-store';

/** SettingsShortcutsView (workspace/presentation/settings/pages/settings_shortcuts_view.dart). */
export function ShortcutsPage(_: SettingsPageProps) {
  const { tr } = useTr();
  const [query, setQuery] = useState('');
  const editingRef = useRef(false);
  const status = useShortcutsStore((s) => s.status);
  const error = useShortcutsStore((s) => s.error);
  const shortcuts = useShortcutsStore((s) => s.commandShortcutEvents);

  // ShortcutsCubit(SettingsShortcutService())..fetchShortcuts()
  useEffect(() => {
    shortcutsActions.reset();
    void shortcutsActions.fetchShortcuts();
  }, []);

  const filtered = shortcuts
    .map((command) => ({ command, label: shortcutLabel(command) }))
    .filter(({ label }) => label.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <SettingsPageHeader title={tr('settings.shortcutsPage.title')} />
      <SettingsSection>
        <div className="flex items-center gap-3">
          <InputGroup><InputGroupAddon><Search className="size-4" /></InputGroupAddon><InputGroupInput spellCheck={false} placeholder={tr('settings.shortcutsPage.searchHint')} aria-label={tr('settings.shortcutsPage.searchHint')} onChange={(event) => setQuery(event.target.value)} /></InputGroup>
          <ResetButton onReset={() => showConfirmDialog({
            title: tr('settings.shortcutsPage.resetDialog.title'),
            description: tr('settings.shortcutsPage.resetDialog.description'),
            confirmLabel: tr('settings.shortcutsPage.resetDialog.buttonLabel'),
            style: 'cancelAndOk',
            onConfirm: () => void shortcutsActions.resetToDefault(),
          })} />
        </div>
        {isShortcutsLoading(status) ? <div className="flex justify-center py-4"><Spinner /></div> : status === 'failure' ? (
          <Empty><EmptyHeader><EmptyTitle>{tr('settings.shortcutsPage.errorPage.message', { args: [error] })}</EmptyTitle><EmptyDescription>{tr('settings.shortcutsPage.errorPage.howToFix')}</EmptyDescription></EmptyHeader></Empty>
        ) : <SettingsGroup>{filtered.map(({ command, label }) => <ShortcutSettingTile key={command.key} command={command} label={label} canStartEditing={() => !editingRef.current} onStartEditing={() => (editingRef.current = true)} onFinishEditing={() => (editingRef.current = false)} />)}</SettingsGroup>}
      </SettingsSection>
    </>
  );
}

/** Reset every shortcut to its default binding after confirmation. */
function ResetButton({ onReset }: { onReset: () => void }) {
  const { tr } = useTr();
  return <Button variant="outline" size="sm" onClick={onReset}><RotateCcw className="size-4" />{tr('settings.shortcutsPage.actions.resetDefault')}</Button>;
}

/** ShortcutSettingTile: label | first keybinding as badges, or the key-capture editor. */
function ShortcutSettingTile({
  command,
  label,
  canStartEditing,
  onStartEditing,
  onFinishEditing,
}: {
  command: CommandShortcutEvent;
  label: string;
  canStartEditing: () => boolean;
  onStartEditing: () => void;
  onFinishEditing: () => void;
}) {
  const { tr } = useTr();
  const [isHovering, setHovering] = useState(false);
  const [isEditing, setEditing] = useState(false);
  const [text, setTextState] = useState('');
  const textRef = useRef('');
  const canClickOutside = useRef(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const finishRef = useRef<() => void>(() => {});

  const setText = (value: string) => {
    textRef.current = value;
    setTextState(value);
  };

  const finishEditing = () => {
    setEditing(false);
    setText('');
    onFinishEditing();
  };
  finishRef.current = finishEditing;

  const updateCommand = () => {
    command.updateCommand(textRef.current);
    void shortcutsActions.updateAllShortcuts();
    finishEditing();
  };

  // TapRegion.onTapOutside: a pointer down outside the editor cancels, unless the conflict dialog is up.
  useEffect(() => {
    if (!isEditing) return;
    const onPointerDown = (event: MouseEvent) => {
      if (canClickOutside.current) return;
      if (editorRef.current?.contains(event.target as Node)) return;
      finishRef.current();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [isEditing]);

  const commit = () => {
    const binding = textRef.current;
    if (binding === command.command) {
      finishEditing();
      return;
    }
    const conflict = shortcutsActions.getConflict(command, binding);
    if (!conflict) {
      updateCommand();
      return;
    }
    canClickOutside.current = true;
    // The dialog route takes the focus in Flutter; keys must not reach the binding field meanwhile.
    inputRef.current?.blur();
    showDialog(
      (close) => (
        <SettingsAlertDialog
          title={tr('settings.shortcutsPage.conflictDialog.title', { args: [binding] })}
          confirmLabel={tr('settings.shortcutsPage.conflictDialog.confirmLabel')}
          confirm={() => {
            conflict.clearCommand();
            updateCommand();
            close();
          }}
          close={close}
        >
          <div className="whitespace-pre-wrap text-sm text-muted-foreground">
            {tr('settings.shortcutsPage.conflictDialog.descriptionPrefix')}
            <span className="font-semibold text-foreground">{shortcutLabel(conflict)}</span>
            {tr('settings.shortcutsPage.conflictDialog.descriptionSuffix', { args: [binding] })}
          </div>
        </SettingsAlertDialog>
      ),
      {
        onClosed: () => {
          canClickOutside.current = false;
          inputRef.current?.focus();
        },
      },
    );
  };

  const first = command.keybindings[0];
  const conflict = isEditing && text !== '' ? shortcutsActions.getConflict(command, text) : null;
  return (
    <div onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)} className="transition-colors hover:bg-muted/50">
      <SettingsRow label={<span className="font-normal">{label}</span>} control={
        <div className="flex items-center gap-2">
          {isEditing ? <div ref={editorRef} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground ring-2 ring-ring">
            <input ref={inputRef} autoFocus value={text} placeholder={tr('settings.shortcutsPage.editBindingHint')} spellCheck={false} className="min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground" onChange={() => {}} onKeyDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.code === 'Enter' && !event.shiftKey) commit();
              else if (event.key === 'Escape') finishEditing();
              else setText(keyEventToCommand(event.nativeEvent));
            }} />
            {text !== '' && <Button variant="ghost" size="icon-xs" aria-label={tr('button.clear')} onMouseDown={(event) => event.preventDefault()} onClick={() => setText('')}><X className="size-3" /></Button>}
          </div> : <>
            <span className="flex min-h-6 items-center">{first && <ShortcutKeys keys={keybindingParts(first).join('+')} />}</span>
            <Tooltip message={tr('settings.shortcutsPage.editTooltip')}><Button variant="ghost" size="icon-xs" aria-label={tr('settings.shortcutsPage.editTooltip')} className={isHovering ? '' : 'opacity-0 focus-visible:opacity-100'} onClick={() => {
              if (canStartEditing()) {
                onStartEditing();
                setEditing(true);
              }
            }}><PencilLine className="size-4" /></Button></Tooltip>
            <Button variant="ghost" size="icon-xs" aria-label={tr('settings.shortcutsPage.actions.resetDefault')} onClick={() => {
              command.clearCommand();
              command.updateCommand(platformCommand(command.definition));
              void shortcutsActions.updateAllShortcuts();
            }}><RotateCcw className="size-3" /></Button>
          </>}
        </div>
      }>
        {conflict && <p className="text-xs text-destructive">{tr('settings.shortcutsPage.conflictDialog.title', { args: [text] })}</p>}
      </SettingsRow>
    </div>
  );
}

/** Kept for callers of the original key badge. */
export function KeyBadge({ keyLabel }: { keyLabel: string }) {
  if (keyLabel === '') return null;
  return <Kbd className="capitalize">{keyLabel.toLowerCase()}</Kbd>;
}
