import { useId, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LayoutDirectionPB, TextDirectionPB, ThemeModePB } from '@shared/protobuf/flowy-user/user_setting_pb';
import { UserDateFormatPB, UserTimeFormatPB } from '@shared/protobuf/flowy-user/date_time_pb';
import { CircleCheck, Folder, RotateCcw, Trash2, Upload, X, Paintbrush } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldError } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem } from '@/components/ui/combobox';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ColorPicker, ColorPickerPanel, ColorPickerArea, ColorPickerSlider } from '@/components/reui/color-picker';
import { SettingsGroup, SettingsRow, SettingsSection } from '@/components/app/settings-layout';
import { cn } from '@/lib/utils';
import { useTr, tr } from '@/i18n';
import { KeyValueStorage } from '@/startup/kv';
import { appearanceActions, effectiveBrightness, useAppearanceStore } from '@/theme/appearance-store';
import { builtInColorSchemes } from '@/theme/color-schemes';
import { formatDate, formatTime } from '@/features/view-header/date-format';
import { Tooltip, showConfirmDialog, showDialog } from '@/ui';
import { SettingsDropdown } from '../shared';
import { SettingListTile, SettingsResetButton } from '../shared-widgets';
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

const MODES: Array<{ mode: ThemeModePB; label: string }> = [
  { mode: ThemeModePB.System, label: 'settings.workspacePage.appearance.options.system' },
  { mode: ThemeModePB.Light, label: 'settings.workspacePage.appearance.options.light' },
  { mode: ThemeModePB.Dark, label: 'settings.workspacePage.appearance.options.dark' },
];

/** Miniature mode previews are the spec's only literal zinc surfaces. */
function HyperAppearanceMock({ dark }: { dark: boolean }) {
  return <div className={cn('flex h-full flex-1 overflow-hidden rounded-md', dark ? 'bg-zinc-900' : 'bg-white')}>
    <div className={cn('w-1/4 p-1', dark ? 'bg-zinc-950' : 'bg-zinc-100')}><div className={cn('mt-2 h-1 rounded-full', dark ? 'bg-zinc-700' : 'bg-zinc-200')} /></div>
    <div className="flex-1 space-y-2 p-2"><div className={cn('h-2 w-3/4 rounded-sm', dark ? 'bg-zinc-700' : 'bg-zinc-200')} /><div className={cn('h-1 rounded-sm', dark ? 'bg-zinc-700' : 'bg-zinc-200')} /><div className={cn('h-1 w-2/3 rounded-sm', dark ? 'bg-zinc-700' : 'bg-zinc-200')} /></div>
  </div>;
}

export function AppearanceSelector() {
  const { tr } = useTr();
  const themeMode = useAppearanceStore((s) => s.appearance.themeMode);
  return <div className="flex flex-wrap items-start gap-4">
    {MODES.map(({ mode, label }) => {
      const selected = mode === themeMode;
      return <button type="button" key={mode} className="flex w-36 flex-col gap-2 text-xs focus-visible:outline-2 focus-visible:outline-ring" onClick={() => void appearanceActions.setThemeMode(mode)}>
        <div data-selected={selected ? 'true' : undefined} className="relative flex aspect-[4/3] w-full overflow-hidden rounded-lg border-2 border-border p-1 data-[selected=true]:border-primary">
          {mode === ThemeModePB.System ? <><HyperAppearanceMock dark={false} /><HyperAppearanceMock dark /></> : <HyperAppearanceMock dark={mode === ThemeModePB.Dark} />}
          {selected && <CircleCheck className="absolute top-2 right-2 size-4 text-primary" />}
        </div>
        <span className="w-full text-center">{tr(label)}</span>
      </button>;
    })}
  </div>;
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
      showDialog((closeError) => <div className="flex w-[min(25rem,calc(100vw-2rem))] flex-col gap-4 rounded-xl bg-popover p-4 shadow-xl ring-1 ring-foreground/10">
        <div className="text-sm">{tr('settings.appearance.themeUpload.urlUploadFailure', { args: ['https://docs.appflowy.io/docs/appflowy/product/themes'] })}</div>
        <div className="text-xs text-muted-foreground">{tr('errorDialog.howToFixFallback')}</div>
        <Button className="self-end" onClick={closeError}>{tr('button.ok')}</Button>
      </div>),
    );
  return <div className="relative flex w-[min(30rem,calc(100vw-5rem))] flex-col gap-4 rounded-xl bg-popover p-4 text-popover-foreground shadow-xl ring-1 ring-foreground/10">
    <div className="flex items-center gap-2"><h2 className="flex-1 text-base font-medium">{tr('settings.appearance.themeUpload.button')}</h2><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => close(false)}><X className="size-4" /></Button></div>
    <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center">
      {state.kind === 'processing' ? <div className="text-sm">{tr('settings.appearance.themeUpload.loading')}</div> : <>
        {state.kind === 'failure' && <div className="text-sm text-destructive">{state.message}</div>}
        <Folder className="size-5 text-muted-foreground" />
        <div className="text-sm">{tr('settings.appearance.themeUpload.description')}</div>
        <Button variant="ghost" size="sm" onClick={() => void learnMore()}>{tr('document.plugins.autoGeneratorLearnMore')}</Button>
        <Button size="sm" onClick={() => void upload()}>{tr('settings.appearance.themeUpload.button')}</Button>
      </>}
    </div>
  </div>;
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
      className="size-4 rounded-md ring-1 ring-foreground/15" style={{ background: builtInColorSchemes[name]?.[brightness].sidebarBg }}
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
      trailing: <Button variant="ghost" size="icon-xs" aria-label="Delete" className="hover:text-destructive" onClick={() => void removeTheme(name)}><Trash2 className="size-4" /></Button>,
    })),
  ];

  return <SettingsRow label={tr('settings.workspacePage.theme.title')} control={<SettingsDropdown selected={theme} options={options} onChanged={(value) => void appearanceActions.setTheme(value)} expandWidth={false} actions={<>
    <Tooltip message={tr('settings.workspacePage.theme.uploadCustomThemeTooltip')}><Button variant="outline" size="icon-sm" aria-label={tr('settings.workspacePage.theme.uploadCustomThemeTooltip')} onClick={() => showDialog((close) => <ThemeUploadDialog close={(uploaded) => { close(); if (uploaded) onUploaded(); }} />)}><Upload className="size-4" /></Button></Tooltip>
    <Button variant="ghost" size="sm" onClick={() => void appearanceActions.setTheme('Default')}><RotateCcw className="size-4" />{tr('settings.common.reset')}</Button>
  </>} />} />;
}

// ---- Document cursor / selection colors -------------------------------------------------

function ColorField({ label, hint, value, error, onChange, suffix }: { label: string; hint: string; value: string; error: string | null; onChange: (v: string) => void; suffix?: ReactNode }) {
  const id = useId();
  return <Field data-invalid={error ? 'true' : undefined}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel><InputGroup><InputGroupInput id={id} value={value} placeholder={hint} aria-invalid={!!error} onChange={(event) => onChange(event.target.value)} />{suffix && <InputGroupAddon align="inline-end">{suffix}</InputGroupAddon>}</InputGroup>
    {error && <FieldError className="text-xs">{error}</FieldError>}
  </Field>;
}

/** Keep the nested picker draft and its explicit Done/Cancel actions. */
function ColorPickerDialog({ initial, close }: { initial: string; close: (result: string | null) => void }) {
  const { tr } = useTr();
  const [value, setValue] = useState(hexStringToCss(initial));
  return <div className="flex flex-col gap-3">
    <h3 className="text-base font-medium">{tr('settings.appearance.documentSettings.pickColor')}</h3>
    <div className="text-xs text-muted-foreground">{tr('settings.appearance.documentSettings.colorShade')}</div>
    <div className="text-xs text-muted-foreground">{tr('settings.appearance.documentSettings.opacity')}</div>
    <ColorPicker value={value} alpha format="hex" onValueChange={(next) => { if (next) setValue(next); }} i18n={{ labels: { alpha: tr('settings.appearance.documentSettings.opacity') } }}><ColorPickerPanel /></ColorPicker>
    <div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => close(null)}>{tr('button.cancel')}</Button><Button size="sm" onClick={() => close(cssToHexString(value))}>{tr('button.done')}</Button></div>
  </div>;
}

/** _DocumentColorSettingDialog: preview, Hex and Opacity fields. */
function ColorSettingForm({ current, preview, onChanged }: { current: string; preview: (css: string | null) => ReactNode; onChanged: (hex: string) => void }) {
  const { tr } = useTr();
  const [hex, setHex] = useState(extractHex(current));
  const [opacity, setOpacity] = useState(extractOpacity(current));
  const [touched, setTouched] = useState(false);
  const [selected, setSelected] = useState<string | null>(current);
  const [pickerOpen, setPickerOpen] = useState(false);
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
    <div className="flex flex-col gap-2">
      <ColorPicker value={selected ? hexStringToCss(selected) : hexStringToCss(current)} alpha format="hex" onValueChange={(value) => {
        if (!value) return;
        const result = cssToHexString(value);
        const nextHex = extractHex(result), nextOpacity = extractOpacity(result);
        setHex(nextHex); setOpacity(nextOpacity); update(nextHex, nextOpacity);
      }} i18n={{ labels: { alpha: tr('settings.appearance.documentSettings.opacity'), hex: tr('editor.hexValue'), panelLabel: tr('settings.appearance.documentSettings.pickColor') } }}><ColorPickerPanel>
        <div className="text-xs text-muted-foreground">{tr('settings.appearance.documentSettings.colorShade')}</div><ColorPickerArea /><ColorPickerSlider channel="hue" />
        <div className="text-xs text-muted-foreground">{tr('settings.appearance.documentSettings.opacity')}</div><ColorPickerSlider channel="alpha" />
      </ColorPickerPanel></ColorPicker>
      <div className="flex h-10 w-25 items-center justify-center self-center">
        {preview(selected ? hexStringToCss(selected) : null)}
      </div>
      <ColorField
        label={tr('editor.hexValue')}
        hint="6fc9e7"
        value={hex}
        error={hexError}
        onChange={(v) => {
          setHex(v);
          update(v, opacity);
        }}
        suffix={<Popover open={pickerOpen} onOpenChange={setPickerOpen}><PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={tr('settings.appearance.documentSettings.pickColor')} />}><Paintbrush className="size-4" /></PopoverTrigger><PopoverContent className="max-h-[min(37.5rem,calc(100vh-5rem))] w-80 overflow-y-auto p-4">
          <ColorPickerDialog initial={current} close={(result) => {
            setPickerOpen(false);
            if (!result) return;
            const nextHex = extractHex(result), nextOpacity = extractOpacity(result);
            setHex(nextHex); setOpacity(nextOpacity); update(nextHex, nextOpacity);
          }} />
        </PopoverContent></Popover>}
      />
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

/** Swatch popover keeps edits local until the existing confirm action. */
function DocumentColorSettingButton({ current, preview, dialogTitle, onApply }: { current: string; preview: (css: string | null) => ReactNode; dialogTitle: string; onApply: (hex: string) => void }) {
  const { tr } = useTr();
  const [open, setOpen] = useState(false);
  const next = useRef(current);
  return <Popover open={open} onOpenChange={(value) => { if (value) next.current = current; setOpen(value); }}>
    <PopoverTrigger render={<button type="button" aria-label={dialogTitle} className="size-6 rounded-md ring-1 ring-foreground/15 focus-visible:outline-2 focus-visible:outline-ring" style={{ background: hexStringToCss(current) }} />} />
    <PopoverContent className="max-h-[min(37.5rem,calc(100vh-5rem))] w-80 overflow-y-auto p-4">
      <h3 className="text-base font-medium">{dialogTitle}</h3>
      <ColorSettingForm key={open ? current : 'closed'} current={current} preview={preview} onChanged={(value) => (next.current = value)} />
      <div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setOpen(false)}>{tr('button.cancel')}</Button><Button size="sm" onClick={() => { onApply(next.current); setOpen(false); }}>{tr('button.confirm')}</Button></div>
    </PopoverContent>
  </Popover>;
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
  const preview = (css: string | null) =>
    kind === 'cursor' ? (
      <div className="flex items-center">
        <div className="h-4 w-0.5" style={{ background: css ?? hexStringToCss(fallback) }} />
        <span className="text-sm text-foreground">{tr('appName')}</span>
      </div>
    ) : (
      <div className="flex items-center">
        <div style={{ background: css ?? hexStringToCss(fallback) }}>
          <span className="text-sm text-foreground">{tr('settings.appearance.documentSettings.app')}</span>
        </div>
        <span className="text-sm text-foreground">{tr('settings.appearance.documentSettings.flowy')}</span>
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
  return <SettingsRow label={tr('settings.appearance.documentSettings.width')} control={<><span className="text-xs text-muted-foreground tabular-nums">{width}</span><SettingsResetButton onResetRequested={() => sync(MAX_DOCUMENT_WIDTH)} /></>}>
    <Slider aria-label={tr('settings.appearance.documentSettings.width')} value={[width]} min={MIN_DOCUMENT_WIDTH} max={MAX_DOCUMENT_WIDTH} step={step} onValueChange={(value) => sync(Array.isArray(value) ? value[0] : value)} className="w-full py-2" />
  </SettingsRow>;
}

// ---- Workspace font -----------------------------------------------------------------------

/** One font row, rendered in its own font once a subset preview is loaded. */
function FontRow({ font, selected }: { font: string; selected: boolean }) {
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
  return <ComboboxItem ref={ref} value={font} data-selected={selected ? 'true' : undefined}><span className="flex-1 text-sm" style={{ fontFamily: family }}>{name}</span></ComboboxItem>;
}

/** _FontSelectorDropdown: a filter field over '' + GoogleFonts.asMap().keys, with a reset button. */
export function FontSelectorDropdown() {
  const { tr } = useTr();
  const currentFont = useAppearanceStore((s) => s.appearance.font);
  const [text, setText] = useState(() => fontFamilyDisplayName(currentFont));
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const options = useMemo(() => ['', ...googleFontNames], []);
  const [filtered, setFiltered] = useState(options);
  const select = (font: string) => {
    void appearanceActions.setFontFamily(font);
    setText(fontFamilyDisplayName(font));
    setOpen(false);
  };
  return <SettingsRow label={tr('settings.workspacePage.workspaceFont.title')}>
    <div className="flex items-center gap-2">
      <Combobox items={filtered} filter={null} value={currentFont} inputValue={text} itemToStringLabel={fontFamilyDisplayName} open={open}
        onOpenChange={(next) => { setOpen(next); if (next) requestAnimationFrame(() => { const index = filtered.indexOf(currentFont); if (listRef.current && index > 0) listRef.current.scrollTop = index * 32; }); }}
        onValueChange={(value) => { if (value !== null) select(value); }}
        onInputValueChange={(value, details) => { if (details.reason === 'input-change') { setText(value); setFiltered((previous) => filterFonts(options, value, currentFont, previous)); setOpen(true); } }}>
        <ComboboxInput className="flex-1" spellCheck={false} onMouseDown={() => { if (!open) setOpen(true); }} />
        <ComboboxContent><ComboboxList ref={listRef} className="max-h-40">{filtered.length === 0 ? <div className="p-2 text-sm text-muted-foreground">{tr('settings.workspacePage.workspaceFont.noFontHint')}</div> : filtered.map((font) => <FontRow key={font || '__system'} font={font} selected={font === currentFont} />)}</ComboboxList></ComboboxContent>
      </Combobox>
      <Button variant="ghost" size="sm" onClick={() => { void appearanceActions.setFontFamily(''); setText(fontFamilyDisplayName('')); }}><RotateCcw className="size-4" />{tr('settings.common.reset')}</Button>
    </div>
  </SettingsRow>;
}

// ---- Text / layout direction ---------------------------------------------------------------

const TEXT_DIRECTIONS: Array<{ value: TextDirectionPB; name: 'ltr' | 'rtl' | 'auto'; label: string }> = [
  { value: TextDirectionPB.LTR, name: 'ltr', label: 'settings.workspacePage.textDirection.leftToRight' },
  { value: TextDirectionPB.RTL, name: 'rtl', label: 'settings.workspacePage.textDirection.rightToLeft' },
  { value: TextDirectionPB.AUTO, name: 'auto', label: 'settings.workspacePage.textDirection.auto' },
];

/** TextDirectionSelect: FALLBACK reads as LTR; also DocumentAppearanceCubit.syncDefaultTextDirection. */
export function TextDirectionSelect() {
  const { tr } = useTr();
  const raw = useAppearanceStore((s) => s.appearance.textDirection);
  const current = raw === TextDirectionPB.RTL || raw === TextDirectionPB.AUTO ? raw : TextDirectionPB.LTR;
  return <SettingsRow label={tr('settings.workspacePage.textDirection.title')}>
    <ToggleGroup variant="outline" size="sm" value={[String(current)]} onValueChange={(values) => {
      const d = TEXT_DIRECTIONS.find((item) => String(item.value) === values[0]); if (!d) return;
      void appearanceActions.setTextDirection(d.value); void KeyValueStorage.set(DocumentAppearanceKeys.defaultTextDirection, d.name);
    }}>{TEXT_DIRECTIONS.map((d) => <ToggleGroupItem key={d.name} value={String(d.value)}>{tr(d.label)}</ToggleGroupItem>)}</ToggleGroup>
  </SettingsRow>;
}

/** A 16px label with a trailing Toggle (EnableRTLItemsSwitcher, _TimeFormatSwitcher). */
function ToggleRow({ label, value, onChanged }: { label: string; value: boolean; onChanged: (v: boolean) => void }) {
  return <SettingsRow label={label} control={<Switch checked={value} onCheckedChange={onChanged} aria-label={label} />} />;
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
    { value: LayoutDirectionPB.LTRLayout, label: tr('settings.workspacePage.layoutDirection.leftToRight') },
    { value: LayoutDirectionPB.RTLLayout, label: tr('settings.workspacePage.layoutDirection.rightToLeft') },
  ];
  return <SettingsRow label={tr('settings.workspacePage.layoutDirection.title')} control={<SettingsDropdown expandWidth={false} selected={value === LayoutDirectionPB.RTLLayout ? LayoutDirectionPB.RTLLayout : LayoutDirectionPB.LTRLayout} options={items} onChanged={(v) => void appearanceActions.setLayoutDirection(v)} />} />;
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
  return <SettingsSection title={tr('settings.workspacePage.dateTime.title')} description={tr('settings.workspacePage.dateTime.example', { args: [formatDate(now, dateFormat, false), formatTime(now, timeFormat), timeZoneName(now)] })}>
    <SettingsGroup>
      <ToggleRow label={tr('settings.workspacePage.dateTime.24HourTime')} value={timeFormat === UserTimeFormatPB.TwentyFourHour} onChanged={(v) => void appearanceActions.setTimeFormat(v ? UserTimeFormatPB.TwentyFourHour : UserTimeFormatPB.TwelveHour)} />
      <SettingsRow label={tr('settings.workspacePage.dateTime.dateFormat.label')} control={<SettingsDropdown selected={dateFormat} expandWidth={false} showCheck={false} options={DATE_FORMATS.map((f) => ({ value: f.value, label: tr(f.label) }))} onChanged={(v) => void appearanceActions.setDateFormat(v)} />} />
    </SettingsGroup>
  </SettingsSection>;
}
