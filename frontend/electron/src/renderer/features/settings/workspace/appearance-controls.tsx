import { useId, useRef, useState, type ReactNode } from 'react';
import { Folder, X, Paintbrush } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldError } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ColorPicker, ColorPickerPanel, ColorPickerArea, ColorPickerSlider } from '@/components/reui/color-picker';
import { useTr, tr } from '@/i18n';
import { appearanceActions, effectiveBrightness, useAppearanceStore } from '@/theme/appearance-store';
import { builtInColorSchemes } from '@/theme/color-schemes';
import { showDialog } from '@/ui';
import { PluginCompilationError, colorSchemeToJson, decodeThemePlugin } from './hyper-theme';
import {
  cssToHexString,
  extractHex,
  extractOpacity,
  combineHexWithOpacity,
  hexStringToCss,
  validateHexValue as validateHex,
  validateOpacityValue as validateOpacity,
} from './appearance-utils';

const validateOpacityValue = (value: string) => validateOpacity(value, tr);
const validateHexValue = (hex: string, opacity: string) => validateHex(hex, opacity, tr);

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

export const useCurrentScheme = () =>
  useAppearanceStore((s) => {
    const scheme = builtInColorSchemes[s.appearance.theme || 'Default'] ?? builtInColorSchemes.Default;
    return scheme[effectiveBrightness(s)];
  });

// ---- Theme (color scheme) ---------------------------------------------------------------

/** ThemeUploadWidget (widgets/theme_upload/*): pick a `<name>.hyper_plugin` folder. */
export function ThemeUploadDialog({ close }: { close: (uploaded: boolean) => void }) {
  const { tr } = useTr();
  const [state, setState] = useState<{ kind: 'ready' } | { kind: 'processing' } | { kind: 'failure'; message: string }>({ kind: 'ready' });

  const upload = async () => {
    const dir = await window.hypertask.dialog.pickDirectory();
    if (!dir) return;
    setState({ kind: 'processing' });
    try {
      const files = await window.hypertask.themes.readPluginDirectory(dir);
      if (!files.ok) throw new PluginCompilationError(files.message);
      const theme = decodeThemePlugin(files.value);
      await window.hypertask.themes.install({ name: theme.name, light: colorSchemeToJson(theme.light), dark: colorSchemeToJson(theme.dark) });
      await appearanceActions.refreshCustomThemes();
      close(true);
    } catch (error) {
      setState({ kind: 'failure', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const learnMore = () =>
    window.hypertask.shell.openExternal('https://docs.hypertask.io/docs/hypertask/product/themes').catch(() =>
      showDialog((closeError) => <div className="flex w-[min(25rem,calc(100vw-2rem))] flex-col gap-4 rounded-xl bg-popover p-4 shadow-xl ring-1 ring-foreground/10">
        <div className="text-sm">{tr('settings.appearance.themeUpload.urlUploadFailure', { args: ['https://docs.hypertask.io/docs/hypertask/product/themes'] })}</div>
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
export function DocumentColorSettingButton({ current, preview, dialogTitle, onApply }: { current: string; preview: (css: string | null) => ReactNode; dialogTitle: string; onApply: (hex: string) => void }) {
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
