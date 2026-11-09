import { useEffect, useRef, useState } from 'react';
import { FlowySvg } from '@/icons/FlowySvg';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { useTr } from '@/i18n';
import { AFTextField, FlowyHover, FlowyText, HSpace, Spinner, Tooltip, VSpace, showConfirmDialog, showDialog } from '@/ui';
import type { SettingsPageProps } from '../page-props';
import { SettingsBody } from '../shared';
import { FlowyErrorMessage, SettingsAlertDialog } from '../shared-widgets';
import {
  isShortcutsLoading,
  keyEventToCommand,
  keybindingParts,
  shortcutLabel,
  shortcutsActions,
  useShortcutsStore,
  type CommandShortcutEvent,
} from './shortcuts-store';
import './shortcuts.css';

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
    <SettingsBody title={tr('settings.shortcutsPage.title')} autoSeparate={false}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <AFTextField hintText={tr('settings.shortcutsPage.searchHint')} onChanged={setQuery} />
        </div>
        <HSpace size={10} />
        <ResetButton
          onReset={() =>
            showConfirmDialog({
              title: tr('settings.shortcutsPage.resetDialog.title'),
              description: tr('settings.shortcutsPage.resetDialog.description'),
              confirmLabel: tr('settings.shortcutsPage.resetDialog.buttonLabel'),
              style: 'cancelAndOk',
              onConfirm: () => void shortcutsActions.resetToDefault(),
            })
          }
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <VSpace size={16} />
        {isShortcutsLoading(status) ? (
          <Spinner />
        ) : status === 'failure' ? (
          <FlowyErrorMessage
            message={tr('settings.shortcutsPage.errorPage.message', { args: [error] })}
            howToFix={tr('settings.shortcutsPage.errorPage.howToFix')}
          />
        ) : (
          <div style={{ alignSelf: 'stretch' }}>
            {filtered.map(({ command, label }) => (
              <ShortcutSettingTile
                key={command.key}
                command={command}
                label={label}
                canStartEditing={() => !editingRef.current}
                onStartEditing={() => (editingRef.current = true)}
                onFinishEditing={() => (editingRef.current = false)}
              />
            ))}
          </div>
        )}
      </div>
    </SettingsBody>
  );
}

/** _ResetButton: FlowyHover, padding 4/6, restore_s 20 + "Reset default" in strongText. */
function ResetButton({ onReset }: { onReset: () => void }) {
  const { tr } = useTr();
  return (
    <FlowyHover onClick={onReset} style={{ padding: '4px 6px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      <FlowySvg svg="restore_s" size={20} />
      <HSpace size={6} />
      <div style={{ height: 16, display: 'flex', alignItems: 'center' }}>
        <FlowyText color="var(--afx-strong-text)">{tr('settings.shortcutsPage.actions.resetDefault')}</FlowyText>
      </div>
    </FlowyHover>
  );
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
          <div
            style={{
              textAlign: 'center',
              fontSize: 'calc(16px * var(--text-scale, 1))',
              fontWeight: 400,
              color: 'var(--text-color)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {tr('settings.shortcutsPage.conflictDialog.descriptionPrefix')}
            <span style={{ fontWeight: 700 }}>{shortcutLabel(conflict)}</span>
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
  return (
    <div style={{ padding: '4px 0', borderTop: '1px solid var(--th-divider)' }}>
      <FlowyHover
        hoverColor="var(--cs-secondary-container)"
        borderRadius={0}
        cursor="default"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={{ padding: '4px 0', display: 'flex', alignItems: 'center' }}
      >
        <HSpace size={8} />
        <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
          <FlowyText lineHeight={14} maxLines={2} color="var(--afx-strong-text)">
            {label}
          </FlowyText>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {isEditing ? (
            <div ref={editorRef} className="shortcut-binding-field">
              <input
                ref={inputRef}
                autoFocus
                value={text}
                placeholder={tr('settings.shortcutsPage.editBindingHint')}
                spellCheck={false}
                onChange={() => {}}
                onKeyDown={(event) => {
                  // Every key is consumed (KeyEventResult.handled): nothing is typed.
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.code === 'Enter' && !event.shiftKey) commit();
                  else if (event.key === 'Escape') finishEditing();
                  else setText(keyEventToCommand(event.nativeEvent));
                }}
              />
              {text !== '' && (
                <span
                  style={{ display: 'flex', cursor: 'pointer', marginLeft: 8 }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setText('')}
                >
                  <FlowySvg svg="close_s" size={10} />
                </span>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {first ? keybindingParts(first).map((key, index) => <KeyBadge key={index} keyLabel={key} />) : <div style={{ height: 24 }} />}
              <div style={{ flex: 1 }} />
              {isHovering && (
                <Tooltip message={tr('settings.shortcutsPage.editTooltip')}>
                  <span
                    style={{ display: 'flex', cursor: 'pointer' }}
                    onClick={() => {
                      if (canStartEditing()) {
                        onStartEditing();
                        setEditing(true);
                      }
                    }}
                  >
                    <FlowySvg svg="edit_s" size={16} />
                  </span>
                </Tooltip>
              )}
              <HSpace size={8} />
            </div>
          )}
        </div>
      </FlowyHover>
    </div>
  );
}

const BADGE_ICONS: Record<string, FlowySvgName> = {
  meta: 'keyboard_meta_s',
  'arrow left': 'keyboard_arrow_left_s',
  'arrow right': 'keyboard_arrow_right_s',
  'arrow up': 'keyboard_arrow_up_s',
  'arrow down': 'keyboard_arrow_down_s',
  shift: 'keyboard_shift_s',
  tab: 'keyboard_tab_s',
  enter: 'keyboard_return_s',
  return: 'keyboard_return_s',
  opt: 'keyboard_option_s',
  option: 'keyboard_option_s',
};

/** KeyBadge: 24 high, greySelect, radius 4, black text (medium 12, lower case) or icon. */
export function KeyBadge({ keyLabel }: { keyLabel: string }) {
  const icon = BADGE_ICONS[keyLabel];
  if (!icon && keyLabel === '') return null;
  return (
    <div
      style={{
        height: 24,
        marginRight: 4,
        padding: '0 8px',
        background: 'var(--afx-grey-select)',
        borderRadius: 4,
        boxShadow: '0 1px 1px #00000040',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {icon ? (
        <FlowySvg svg={icon} color="#000000" />
      ) : (
        <FlowyText fontSize={12} fontWeight={500} color="#000000">
          {keyLabel.toLowerCase()}
        </FlowyText>
      )}
    </div>
  );
}
