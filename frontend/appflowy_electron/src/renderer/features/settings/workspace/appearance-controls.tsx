import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LayoutDirectionPB, TextDirectionPB, ThemeModePB } from '@shared/protobuf/flowy-user/user_setting_pb';
import { UserDateFormatPB, UserTimeFormatPB } from '@shared/protobuf/flowy-user/date_time_pb';
import appearanceSystem from '@flutter-assets/images/appearance/system.png';
import appearanceLight from '@flutter-assets/images/appearance/light.png';
import appearanceDark from '@flutter-assets/images/appearance/dark.png';
import { FlowySvg } from '@/icons/FlowySvg';
import { useTr, tr } from '@/i18n';
import { KeyValueStorage } from '@/startup/kv';
import { appearanceActions, effectiveBrightness, useAppearanceStore } from '@/theme/appearance-store';
import { builtInColorSchemes } from '@/theme/color-schemes';
import { formatDate, formatTime } from '@/features/view-header/date-format';
import { AppFlowyPopover, FlowyButton, FlowyDialog, FlowyIconButton, FlowyText, HSpace, MaterialDialog, Toggle, VSpace, showConfirmDialog, showDialog, type PopoverController } from '@/ui';
import { SettingsDropdown, SettingsRadioSelect, SettingsCategory } from '../shared';
import { SettingAction, SettingListTile, SettingsDashedDivider, SettingsResetButton, showSettingsAlertDialog } from '../shared-widgets';
import { MaterialIcon } from '../material';
import { BUILT_IN_THEMES, PluginCompilationError, colorSchemeToJson, decodeThemePlugin } from './flowy-theme';
import {
  cssToHexString,
  extractHex,
  extractOpacity,
  combineHexWithOpacity,
  fontFamilyDisplayName as displayName,
  filterFonts as filterFontsWith,
  hexStringToCss,
  validateHexValue as validateHex,
  validateOpacityValue as validateOpacity,
} from './appearance-utils';
import { googleFontNames } from './google-font-names';

const validateOpacityValue = (value: string) => validateOpacity(value, tr);
const validateHexValue = (hex: string, opacity: string) => validateHex(hex, opacity, tr);
const fontFamilyDisplayName = (font: string) => displayName(font, tr('settings.appearance.fontFamily.defaultFont'));
const filterFonts = (options: string[], value: string, currentFont: string, previous: string[]) =>
  filterFontsWith(options, value, currentFont, previous, tr('settings.appearance.fontFamily.defaultFont'));
import { ensureGoogleFontPreview, previewFamily } from './google-fonts';

// Controls of SettingsWorkspaceView (pages/settings_workspace_view.dart) that drive
// AppearanceSettingsCubit / DocumentAppearanceCubit.

/** KVKeys used by DocumentAppearanceCubit (core/config/kv_keys.dart). */
export const DocumentAppearanceKeys = {
  cursorColor: 'kDocumentAppearanceCursorColor',
  selectionColor: 'kDocumentAppearanceSelectionColor',
  defaultTextDirection: 'kDocumentAppearanceDefaultTextDirection',
  width: 'kDocumentAppearanceWidth',
} as const;

/** EditorStyleCustomizer.minDocumentWidth / maxDocumentWidth. */
export const MIN_DOCUMENT_WIDTH = 480;
export const MAX_DOCUMENT_WIDTH = 1920;

const useCurrentScheme = () =>
  useAppearanceStore((s) => {
    const scheme = builtInColorSchemes[s.appearance.theme || 'Default'] ?? builtInColorSchemes.Default;
    return scheme[effectiveBrightness(s)];
  });

// ---- Appearance (theme mode) ------------------------------------------------------------

const MODES: Array<{ mode: ThemeModePB; image: string; label: string }> = [
  { mode: ThemeModePB.System, image: appearanceSystem, label: 'settings.workspacePage.appearance.options.system' },
  { mode: ThemeModePB.Light, image: appearanceLight, label: 'settings.workspacePage.appearance.options.light' },
  { mode: ThemeModePB.Dark, image: appearanceDark, label: 'settings.workspacePage.appearance.options.dark' },
];

/**
 * AppearanceSelector: system / light / dark cards. Like Dart, the selected mode is read
 * when the page builds (context.read), so the badge follows the next rebuild.
 */
export function AppearanceSelector() {
  const { tr } = useTr();
  const themeMode = useAppearanceStore((s) => s.appearance.themeMode);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
      {MODES.map(({ mode, image, label }) => {
        const selected = mode === themeMode;
        return (
          <div key={mode} style={{ paddingRight: 16 }}>
            <div className="settings-appearance-card" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center' }} onClick={() => void appearanceActions.setThemeMode(mode)}>
              <div
                style={{
                  position: 'relative',
                  width: 88,
                  height: 72,
                  borderRadius: 4,
                  border: `1px solid ${selected ? 'var(--cs-on-secondary)' : 'var(--cs-outline)'}`,
                  backgroundImage: `url("${image}")`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                {selected && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 4,
                      left: 4,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: 'var(--cs-surface)',
                      boxShadow: '0 1px 3px #0000004D',
                      display: 'flex',
                    }}
                  >
                    <FlowySvg svg="settings_selected_theme_m" size={16} blendMode={null} />
                  </div>
                )}
              </div>
              <VSpace size={6} />
              <FlowyText textAlign="center">{tr(label)}</FlowyText>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Theme (color scheme) ---------------------------------------------------------------

/** ThemeUploadWidget (widgets/theme_upload/*): pick a `<name>.flowy_plugin` folder. */
function ThemeUploadDialog({ close }: { close: (uploaded: boolean) => void }) {
  const { tr } = useTr();
  const [state, setState] = useState<{ kind: 'ready' } | { kind: 'processing' } | { kind: 'failure'; message: string }>({ kind: 'ready' });

  const upload = async () => {
    const dir = await window.appflowy.dialog.pickDirectory();
    if (!dir) return;
    setState({ kind: 'processing' });
    try {
      const files = await window.appflowy.themes.readPluginDirectory(dir);
      if (!files.ok) throw new PluginCompilationError(files.message);
      const theme = decodeThemePlugin(files.value);
      await window.appflowy.themes.install({ name: theme.name, light: colorSchemeToJson(theme.light), dark: colorSchemeToJson(theme.dark) });
      await appearanceActions.refreshCustomThemes();
      close(true);
    } catch (error) {
      setState({ kind: 'failure', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const learnMore = () =>
    window.appflowy.shell.openExternal('https://docs.appflowy.io/docs/appflowy/product/themes').catch(() =>
      showDialog((closeError) => (
        <MaterialDialog width={400} style={{ padding: 24 }}>
          <FlowyText maxLines={null}>{tr('settings.appearance.themeUpload.urlUploadFailure', { args: ['https://docs.appflowy.io/docs/appflowy/product/themes'] })}</FlowyText>
          <VSpace size={8} />
          <FlowyText fontSize={12} color="var(--th-hint)" maxLines={null}>
            {tr('errorDialog.howToFixFallback')}
          </FlowyText>
          <VSpace size={16} />
          <FlowyButton text={tr('button.ok')} useIntrinsicWidth onTap={closeError} />
        </MaterialDialog>
      )),
    );

  const uploadButton = (
    <button
      className="af-button"
      onClick={() => void upload()}
      style={{ '--btn-bg': 'var(--cs-primary)', '--btn-fg': 'var(--cs-on-primary)', '--btn-radius': '8px', width: 100, height: 32 } as React.CSSProperties}
    >
      {tr('settings.appearance.themeUpload.button')}
    </button>
  );

  return (
    <FlowyDialog width={480} expandHeight={false}>
      <div style={{ maxHeight: 300, padding: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, background: 'color-mix(in srgb, var(--cs-surface) 50%, transparent)' }}>
        {state.kind === 'processing' ? (
          <FlowyText maxLines={null}>{tr('settings.appearance.themeUpload.loading')}</FlowyText>
        ) : (
          <>
            {state.kind === 'failure' && (
              <FlowyText color="var(--cs-error)" maxLines={null} textAlign="center">
                {state.message}
              </FlowyText>
            )}
            <FlowySvg svg="folder_m" size={48} color="var(--afx-on-background)" />
            <FlowyText maxLines={null} textAlign="center">
              {tr('settings.appearance.themeUpload.description')}
            </FlowyText>
            <FlowyButton text={tr('document.plugins.autoGeneratorLearnMore')} useIntrinsicWidth onTap={() => void learnMore()} />
            <div style={{ alignSelf: 'stretch', height: 1, background: 'var(--th-divider)' }} />
            {uploadButton}
          </>
        )}
      </div>
    </FlowyDialog>
  );
}

/** _ThemeDropdown: built-ins then custom themes; upload and reset actions. */
export function ThemeDropdown({ onUploaded }: { onUploaded: () => void }) {
  const { tr } = useTr();
  const theme = useAppearanceStore((s) => s.appearance.theme || 'Default');
  const customThemes = useAppearanceStore((s) => s.customThemes);
  const brightness = useAppearanceStore((s) => effectiveBrightness(s));

  useEffect(() => void appearanceActions.refreshCustomThemes(), []);

  const swatch = (name: string) => (
    <div
      style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        border: '1px solid var(--cs-outline)',
        background: builtInColorSchemes[name]?.[brightness].sidebarBg,
      }}
    />
  );

  const removeTheme = async (name: string) => {
    await window.appflowy.themes.remove(name);
    await appearanceActions.refreshCustomThemes();
    if (theme === name) void appearanceActions.setTheme(BUILT_IN_THEMES[0]);
  };

  const options = [
    ...BUILT_IN_THEMES.map((name) => ({ value: name as string, label: name, leading: swatch(name) })),
    ...customThemes.map((name) => ({
      value: name,
      label: name,
      leading: swatch(name),
      trailing: <FlowyIconButton width={20} icon={<FlowySvg svg="delete_s" />} onPressed={() => void removeTheme(name)} />,
    })),
  ];

  return (
    <SettingsDropdown
      selected={theme}
      options={options}
      onChanged={(value) => void appearanceActions.setTheme(value)}
      actions={
        <>
          <SettingAction
            tooltip={tr('settings.workspacePage.theme.uploadCustomThemeTooltip')}
            icon={<FlowySvg svg="folder_m" size={20} />}
            onPressed={() =>
              showDialog((close) => (
                <ThemeUploadDialog
                  close={(uploaded) => {
                    close();
                    if (uploaded) onUploaded();
                  }}
                />
              ))
            }
          />
          <SettingAction icon={<FlowySvg svg="restore_s" size={20} />} label={tr('settings.common.reset')} onPressed={() => void appearanceActions.setTheme('Default')} />
        </>
      }
    />
  );
}

// ---- Document cursor / selection colors -------------------------------------------------

/** OutlineInputBorder text form field used by the color dialog. */
function ColorField({ label, hint, value, error, onChange, suffix }: { label: string; hint: string; value: string; error: string | null; onChange: (v: string) => void; suffix?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', position: 'relative', paddingTop: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          border: `1px solid ${error ? 'var(--cs-error)' : 'var(--cs-outline)'}`,
          borderRadius: 4,
          minHeight: 48,
          padding: '0 12px',
        }}
      >
        <span style={{ position: 'absolute', top: 0, left: 8, padding: '0 4px', background: 'var(--th-card)', fontSize: 'calc(12px * var(--text-scale, 1))', color: error ? 'var(--cs-error)' : 'var(--th-hint)' }}>
          {label}
        </span>
        <input
          value={value}
          placeholder={hint}
          onChange={(event) => onChange(event.target.value)}
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 'calc(14px * var(--text-scale, 1))', color: 'var(--text-color)' }}
        />
        {suffix}
      </div>
      {error && <div style={{ fontSize: 'calc(12px * var(--text-scale, 1))', color: 'var(--cs-error)', padding: '4px 12px 0' }}>{error}</div>}
    </div>
  );
}

/** _showColorPickerDialog (flex_color_picker), simplified to a native color input and an opacity slider. */
function ColorPickerDialog({ initial, close }: { initial: string; close: (result: string | null) => void }) {
  const { tr } = useTr();
  const [rgb, setRgb] = useState(`#${extractHex(initial)}`);
  const [alpha, setAlpha] = useState(parseInt(initial.substring(2, 4), 16));
  return (
    <FlowyDialog width={360} expandHeight={false}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <FlowySvg svg="m_aa_color_s" size={20} />
          <HSpace size={12} />
          <FlowyText fontSize={20}>{tr('settings.appearance.documentSettings.pickColor')}</FlowyText>
        </div>
        <FlowyText fontSize={12} color="var(--th-hint)">
          {tr('settings.appearance.documentSettings.colorShade')}
        </FlowyText>
        <input type="color" value={rgb} onChange={(event) => setRgb(event.target.value)} style={{ width: '100%', height: 40, border: 'none', background: 'transparent' }} />
        <FlowyText fontSize={12} color="var(--th-hint)">
          {tr('settings.appearance.documentSettings.opacity')}
        </FlowyText>
        <input className="md-slider" type="range" min={0} max={255} value={alpha} onChange={(event) => setAlpha(Number(event.target.value))} style={{ ['--fill' as string]: `${(alpha / 255) * 100}%` }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <FlowyButton text={tr('button.cancel')} useIntrinsicWidth margin="12px 24px" onTap={() => close(null)} />
          <button
            className="af-button"
            onClick={() => close(`0x${alpha.toString(16).padStart(2, '0')}${rgb.slice(1)}`.toLowerCase())}
            style={{ '--btn-bg': 'var(--cs-primary)', '--btn-bg-hover': '#005483', '--btn-fg': 'var(--cs-on-primary)', '--btn-radius': '12px', height: 48, padding: '12px 24px' } as React.CSSProperties}
          >
            {tr('button.done')}
          </button>
        </div>
      </div>
    </FlowyDialog>
  );
}

/** _DocumentColorSettingDialog: preview, Hex and Opacity fields. */
function ColorSettingForm({ current, preview, onChanged }: { current: string; preview: (css: string | null) => ReactNode; onChanged: (hex: string) => void }) {
  const { tr } = useTr();
  const [hex, setHex] = useState(extractHex(current));
  const [opacity, setOpacity] = useState(extractOpacity(current));
  const [touched, setTouched] = useState(false);
  const [selected, setSelected] = useState<string | null>(current);
  const hexError = touched ? validateHexValue(hex, opacity) : null;
  const opacityError = touched ? validateOpacityValue(opacity) : null;

  const update = (nextHex: string, nextOpacity: string) => {
    setTouched(true);
    if (validateHexValue(nextHex, nextOpacity) === null && validateOpacityValue(nextOpacity) === null) {
      const value = combineHexWithOpacity(nextHex, nextOpacity);
      setSelected(value);
      onChanged(value);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ width: 100, height: 40, alignSelf: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {preview(selected ? hexStringToCss(selected) : null)}
      </div>
      <VSpace size={8} />
      <ColorField
        label={tr('editor.hexValue')}
        hint="6fc9e7"
        value={hex}
        error={hexError}
        onChange={(v) => {
          setHex(v);
          update(v, opacity);
        }}
        suffix={
          <FlowyIconButton
            icon={<FlowySvg svg="m_aa_color_s" size={20} />}
            onPressed={() =>
              showDialog(
                (close) => (
                  <ColorPickerDialog
                    initial={current}
                    close={(result) => {
                      close();
                      if (!result) return;
                      const nextHex = extractHex(result);
                      const nextOpacity = extractOpacity(result);
                      setHex(nextHex);
                      setOpacity(nextOpacity);
                      update(nextHex, nextOpacity);
                    }}
                  />
                ),
                { barrierColor: '#00000080' },
              )
            }
          />
        }
      />
      <VSpace size={8} />
      <ColorField
        label={tr('editor.opacity')}
        hint="50"
        value={opacity}
        error={opacityError}
        onChange={(v) => {
          setOpacity(v);
          update(hex, v);
        }}
      />
    </div>
  );
}

/** DocumentColorSettingButton: preview button that opens the SettingsAlertDialog. */
function DocumentColorSettingButton({ current, preview, dialogTitle, onApply }: { current: string; preview: (css: string | null) => ReactNode; dialogTitle: string; onApply: (hex: string) => void }) {
  return (
    <FlowyButton
      margin={8}
      hoverColor="var(--cs-secondary-container)"
      expandText={false}
      useIntrinsicWidth
      text={preview(hexStringToCss(current))}
      onTap={() => {
        let next = current;
        showSettingsAlertDialog({
          title: dialogTitle,
          confirm: (close) => {
            onApply(next);
            close();
          },
          children: <ColorSettingForm current={current} preview={preview} onChanged={(value) => (next = value)} />,
        });
      }}
    />
  );
}

/** _DocumentCursorColorSetting / _DocumentSelectionColorSetting. */
export function DocumentColorSetting({ kind }: { kind: 'cursor' | 'selection' }) {
  const { tr } = useTr();
  const scheme = useCurrentScheme();
  const key = kind === 'cursor' ? DocumentAppearanceKeys.cursorColor : DocumentAppearanceKeys.selectionColor;
  const [stored, setStored] = useState(() => KeyValueStorage.get(key));
  // DefaultAppearanceSettings: primary, or primary at alpha 0.2 for the selection.
  const fallback = kind === 'cursor' ? cssToHexString(scheme.primary) : `0x33${cssToHexString(scheme.primary).slice(4)}`;
  const current = stored ?? fallback;
  const label = tr(kind === 'cursor' ? 'settings.appearance.documentSettings.cursorColor' : 'settings.appearance.documentSettings.selectionColor');
  const textColor = 'var(--afx-on-background)';
  const preview = (css: string | null) =>
    kind === 'cursor' ? (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ width: 2, height: 16, background: css ?? hexStringToCss(fallback) }} />
        <FlowyText color={textColor}>{tr('appName')}</FlowyText>
      </div>
    ) : (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ background: css ?? hexStringToCss(fallback) }}>
          <FlowyText color={textColor}>{tr('settings.appearance.documentSettings.app')}</FlowyText>
        </div>
        <FlowyText color={textColor}>{tr('settings.appearance.documentSettings.flowy')}</FlowyText>
      </div>
    );

  const apply = async (hex: string | null) => {
    if (kind === 'cursor') await appearanceActions.setDocumentCursorColor(hex);
    else await appearanceActions.setDocumentSelectionColor(hex);
    if (hex === null) await KeyValueStorage.remove(key);
    else await KeyValueStorage.set(key, hex);
    setStored(hex);
  };

  return (
    <SettingListTile
      label={label}
      onResetRequested={() =>
        showConfirmDialog({
          title: tr(kind === 'cursor' ? 'settings.workspacePage.resetCursorColor.title' : 'settings.workspacePage.resetSelectionColor.title'),
          description: tr(kind === 'cursor' ? 'settings.workspacePage.resetCursorColor.description' : 'settings.workspacePage.resetSelectionColor.description'),
          style: 'cancelAndOk',
          confirmLabel: tr('settings.common.reset'),
          onConfirm: () => void apply(null),
        })
      }
      trailing={<DocumentColorSettingButton key={current} current={current} preview={preview} dialogTitle={label} onApply={(hex) => void apply(hex)} />}
    />
  );
}

/** DocumentPaddingSetting: width slider 480–1920, 10 divisions; reset without confirm. */
export function DocumentWidthSetting() {
  const { tr } = useTr();
  const read = () => {
    const value = Number(KeyValueStorage.get(DocumentAppearanceKeys.width));
    return Number.isFinite(value) && value > 0 ? Math.min(MAX_DOCUMENT_WIDTH, Math.max(MIN_DOCUMENT_WIDTH, value)) : MAX_DOCUMENT_WIDTH;
  };
  const [width, setWidth] = useState(read);
  /** syncWidth: SharedPreferences.setDouble (a JSON number in shared_preferences.json). */
  const sync = (value: number) => {
    const clamped = Math.min(MAX_DOCUMENT_WIDTH, Math.max(MIN_DOCUMENT_WIDTH, value));
    setWidth(clamped);
    // A number, not KeyValueStorage's string, as setDouble writes.
    void window.appflowy.prefs.setDouble(DocumentAppearanceKeys.width, clamped);
  };
  const step = (MAX_DOCUMENT_WIDTH - MIN_DOCUMENT_WIDTH) / 10;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <FlowyText fontWeight={500} style={{ flex: 1 }}>
          {tr('settings.appearance.documentSettings.width')}
        </FlowyText>
        <SettingsResetButton onResetRequested={() => sync(MAX_DOCUMENT_WIDTH)} />
      </div>
      <VSpace size={6} />
      <div style={{ height: 32, paddingRight: 4 }}>
        <input
          className="md-slider"
          type="range"
          min={MIN_DOCUMENT_WIDTH}
          max={MAX_DOCUMENT_WIDTH}
          step={step}
          value={width}
          onChange={(event) => sync(Number(event.target.value))}
          style={{ ['--fill' as string]: `${((width - MIN_DOCUMENT_WIDTH) / (MAX_DOCUMENT_WIDTH - MIN_DOCUMENT_WIDTH)) * 100}%` }}
        />
      </div>
    </div>
  );
}

// ---- Workspace font -----------------------------------------------------------------------

/** One font row, rendered in its own font once a subset preview is loaded. */
function FontRow({ font, selected, onTap }: { font: string; selected: boolean; onTap: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [family, setFamily] = useState<string | undefined>(undefined);
  const name = fontFamilyDisplayName(font);
  useEffect(() => {
    if (font === '' || !ref.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      void ensureGoogleFontPreview(font, name).then((ok) => ok && setFamily(`"${previewFamily(font)}"`));
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [font, name]);
  return (
    <div ref={ref} className="settings-font-row" data-selected={selected ? 'true' : undefined} onClick={onTap}>
      <FlowyText fontFamily={family} style={{ flex: 1 }}>
        {name}
      </FlowyText>
      {selected && <FlowySvg svg="check_s" />}
    </div>
  );
}

/** _FontSelectorDropdown: a filter field over '' + GoogleFonts.asMap().keys, with a reset button. */
export function FontSelectorDropdown() {
  const { tr } = useTr();
  const currentFont = useAppearanceStore((s) => s.appearance.font);
  const [text, setText] = useState(() => fontFamilyDisplayName(currentFont));
  const controller = useRef<PopoverController>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const options = useMemo(() => ['', ...googleFontNames], []);
  const [filtered, setFiltered] = useState(options);

  const select = (font: string) => {
    void appearanceActions.setFontFamily(font);
    setText(fontFamilyDisplayName(font));
    controller.current?.close();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div ref={fieldRef} style={{ flex: 1, minWidth: 0 }}>
        <AppFlowyPopover
          controllerRef={controller}
          trigger="none"
          direction="bottomWithLeftAligned"
          margin={0}
          borderRadius={4}
          constraints={{ maxHeight: 150, width: Math.max(0, (fieldRef.current?.offsetWidth ?? 300) + 16 + 70 - 90) }}
          onOpen={() =>
            requestAnimationFrame(() => {
              const index = filtered.indexOf(currentFont);
              if (listRef.current && index > 0) listRef.current.scrollTop = index * 32;
            })
          }
          popup={() => (
            <div ref={listRef} style={{ overflowY: 'auto', padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filtered.length === 0 ? (
                <FlowyText color="var(--th-hint)">{tr('settings.workspacePage.workspaceFont.noFontHint')}</FlowyText>
              ) : (
                filtered.map((font) => <FontRow key={font || '__system'} font={font} selected={font === currentFont} onTap={() => select(font)} />)
              )}
            </div>
          )}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              border: '1px solid var(--cs-outline)',
              borderRadius: 8,
              padding: '0 6px 0 18px',
            }}
            onFocusCapture={(event) => (event.currentTarget.style.borderColor = 'var(--cs-primary)')}
            onBlurCapture={(event) => (event.currentTarget.style.borderColor = 'var(--cs-outline)')}
          >
            <input
              value={text}
              onMouseDown={() => {
                if (!controller.current?.isOpen()) controller.current?.show();
              }}
              onChange={(event) => {
                setText(event.target.value);
                setFiltered((previous) => filterFonts(options, event.target.value, currentFont, previous));
                if (!controller.current?.isOpen()) controller.current?.show();
              }}
              spellCheck={false}
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', padding: '12px 0', fontSize: 'calc(14px * var(--text-scale, 1))', color: 'var(--text-color)' }}
            />
            {MaterialIcon.arrowDropDown()}
          </div>
        </AppFlowyPopover>
      </div>
      <HSpace size={16} />
      <SettingAction
        icon={<FlowySvg svg="restore_s" size={20} />}
        label={tr('settings.common.reset')}
        onPressed={() => {
          void appearanceActions.setFontFamily('');
          setText(fontFamilyDisplayName(''));
        }}
      />
    </div>
  );
}

// ---- Text / layout direction ---------------------------------------------------------------

const TEXT_DIRECTIONS: Array<{ value: TextDirectionPB; name: 'ltr' | 'rtl' | 'auto'; label: string; icon: 'textdirection_ltr_m' | 'textdirection_rtl_m' | 'textdirection_auto_m' }> = [
  { value: TextDirectionPB.LTR, name: 'ltr', label: 'settings.workspacePage.textDirection.leftToRight', icon: 'textdirection_ltr_m' },
  { value: TextDirectionPB.RTL, name: 'rtl', label: 'settings.workspacePage.textDirection.rightToLeft', icon: 'textdirection_rtl_m' },
  { value: TextDirectionPB.AUTO, name: 'auto', label: 'settings.workspacePage.textDirection.auto', icon: 'textdirection_auto_m' },
];

/** TextDirectionSelect: FALLBACK reads as LTR; also DocumentAppearanceCubit.syncDefaultTextDirection. */
export function TextDirectionSelect() {
  const { tr } = useTr();
  const raw = useAppearanceStore((s) => s.appearance.textDirection);
  const current = raw === TextDirectionPB.RTL || raw === TextDirectionPB.AUTO ? raw : TextDirectionPB.LTR;
  return (
    <SettingsRadioSelect
      items={TEXT_DIRECTIONS.map((d) => ({ value: d, label: tr(d.label), isSelected: d.value === current, icon: <FlowySvg svg={d.icon} /> }))}
      onChanged={(d) => {
        void appearanceActions.setTextDirection(d.value);
        void KeyValueStorage.set(DocumentAppearanceKeys.defaultTextDirection, d.name);
      }}
    />
  );
}

/** A 16px label with a trailing Toggle (EnableRTLItemsSwitcher, _TimeFormatSwitcher). */
function ToggleRow({ label, value, onChanged }: { label: string; value: boolean; onChanged: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <FlowyText fontSize={16} style={{ flex: 1 }}>
        {label}
      </FlowyText>
      <HSpace size={16} />
      <Toggle value={value} onChanged={onChanged} />
    </div>
  );
}

export function EnableRTLItemsSwitcher() {
  const { tr } = useTr();
  const value = useAppearanceStore((s) => s.appearance.enableRtlToolbarItems);
  return <ToggleRow label={tr('settings.workspacePage.textDirection.enableRTLItems')} value={value} onChanged={(v) => void appearanceActions.setEnableRtlToolbarItems(v)} />;
}

export function LayoutDirectionSelect() {
  const { tr } = useTr();
  const value = useAppearanceStore((s) => s.appearance.layoutDirection);
  const items = [
    { value: LayoutDirectionPB.LTRLayout, label: tr('settings.workspacePage.layoutDirection.leftToRight'), icon: 'textdirection_ltr_m' as const },
    { value: LayoutDirectionPB.RTLLayout, label: tr('settings.workspacePage.layoutDirection.rightToLeft'), icon: 'textdirection_rtl_m' as const },
  ];
  return (
    <SettingsRadioSelect
      items={items.map((i) => ({ value: i.value, label: i.label, isSelected: (value === LayoutDirectionPB.RTLLayout ? LayoutDirectionPB.RTLLayout : LayoutDirectionPB.LTRLayout) === i.value, icon: <FlowySvg svg={i.icon} /> }))}
      onChanged={(v) => void appearanceActions.setLayoutDirection(v)}
    />
  );
}

// ---- Date & time ---------------------------------------------------------------------------

/** DateTime.now().timeZoneName (the Windows long name, e.g. "Israel Standard Time"). */
function timeZoneName(date: Date): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'long' }).formatToParts(date).find((p) => p.type === 'timeZoneName');
  return part?.value ?? '';
}

const DATE_FORMATS: Array<{ value: UserDateFormatPB; label: string }> = [
  { value: UserDateFormatPB.Locally, label: 'settings.workspacePage.dateTime.dateFormat.local' },
  { value: UserDateFormatPB.US, label: 'settings.workspacePage.dateTime.dateFormat.us' },
  { value: UserDateFormatPB.ISO, label: 'settings.workspacePage.dateTime.dateFormat.iso' },
  { value: UserDateFormatPB.Friendly, label: 'settings.workspacePage.dateTime.dateFormat.friendly' },
  { value: UserDateFormatPB.DayMonthYear, label: 'settings.workspacePage.dateTime.dateFormat.dmy' },
];

export function DateTimeSettings() {
  const { tr } = useTr();
  const { dateFormat, timeFormat } = useAppearanceStore((s) => s.dateTime);
  const now = new Date();
  return (
    <SettingsCategory title={tr('settings.workspacePage.dateTime.title')}>
      <FlowyText fontSize={16} color="var(--afx-secondary-text)" maxLines={2}>
        {tr('settings.workspacePage.dateTime.example', { args: [formatDate(now, dateFormat, false), formatTime(now, timeFormat), timeZoneName(now)] })}
      </FlowyText>
      <ToggleRow
        label={tr('settings.workspacePage.dateTime.24HourTime')}
        value={timeFormat === UserTimeFormatPB.TwentyFourHour}
        onChanged={(v) => void appearanceActions.setTimeFormat(v ? UserTimeFormatPB.TwentyFourHour : UserTimeFormatPB.TwelveHour)}
      />
      <SettingsDashedDivider color="var(--cs-outline)" />
      <div style={{ paddingTop: 8, display: 'flex', flexDirection: 'column' }}>
        <FlowyText fontSize={16}>{tr('settings.workspacePage.dateTime.dateFormat.label')}</FlowyText>
        <VSpace size={8} />
        <SettingsDropdown
          selected={dateFormat}
          expandWidth={false}
          showCheck={false}
          options={DATE_FORMATS.map((f) => ({ value: f.value, label: tr(f.label) }))}
          onChanged={(v) => void appearanceActions.setDateFormat(v)}
        />
      </div>
    </SettingsCategory>
  );
}
