// The HyperTask settings with no t3code counterpart (text and layout direction, language, document colors and width,
// date and time), drawn with the rows and controls of t3code's Appearance page so the page reads as one. Their
// behavior is that of the former Workspace page (settings_workspace_view.dart): the same store actions and KV keys.

import { useState } from 'react';
import { LayoutDirectionPB, TextDirectionPB } from '@shared/protobuf/hyper-user/user_setting_pb';
import { UserDateFormatPB, UserTimeFormatPB } from '@shared/protobuf/hyper-user/date_time_pb';
import { useI18nStore, useTr } from '@/i18n';
import { KeyValueStorage } from '@/startup/kv';
import { appearanceActions, useAppearanceStore } from '@/theme/appearance-store';
import { formatDate, formatTime } from '@/features/view-header/date-format';
import { showConfirmDialog } from '@/ui';
import { FLUTTER_SUPPORTED_LOCALES, languageFromLocale } from '../language';
import { cssToHexString, hexStringToCss } from '../workspace/appearance-utils';
import {
  DocumentAppearanceKeys,
  DocumentColorSettingButton,
  MAX_DOCUMENT_WIDTH,
  MIN_DOCUMENT_WIDTH,
  useCurrentScheme,
} from '../workspace/appearance-controls';
import { SettingResetButton, SettingsRow, SettingsSection, SettingsSlider } from './appearance-layout';
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue, Switch } from './HyperSettingsControls';

/** A select of fixed options, sized as t3code's Appearance selects. */
function OptionSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <div className="w-full sm:w-40">
      <Select
        value={String(value)}
        onValueChange={(next) => {
          const option = options.find((candidate) => String(candidate.value) === next);
          if (option) onChange(option.value);
        }}
      >
        <SelectTrigger size="sm" className="w-full min-w-0" aria-label={label}>
          <SelectValue>{current?.label ?? String(value)}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          {options.map((option) => (
            <SelectItem key={String(option.value)} value={String(option.value)}>
              {option.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

// ---- Text & language ---------------------------------------------------------------------

const TEXT_DIRECTIONS: Array<{ value: TextDirectionPB; name: 'ltr' | 'rtl' | 'auto'; label: string }> = [
  { value: TextDirectionPB.LTR, name: 'ltr', label: 'settings.workspacePage.textDirection.leftToRight' },
  { value: TextDirectionPB.RTL, name: 'rtl', label: 'settings.workspacePage.textDirection.rightToLeft' },
  { value: TextDirectionPB.AUTO, name: 'auto', label: 'settings.workspacePage.textDirection.auto' },
];

export function HyperTextAndLanguageSection() {
  const { tr } = useTr();
  const rawTextDirection = useAppearanceStore((s) => s.appearance.textDirection);
  // TextDirectionSelect: FALLBACK reads as LTR.
  const textDirection =
    rawTextDirection === TextDirectionPB.RTL || rawTextDirection === TextDirectionPB.AUTO
      ? rawTextDirection
      : TextDirectionPB.LTR;
  const enableRtlItems = useAppearanceStore((s) => s.appearance.enableRtlToolbarItems);
  const layoutDirection = useAppearanceStore((s) =>
    s.appearance.layoutDirection === LayoutDirectionPB.RTLLayout
      ? LayoutDirectionPB.RTLLayout
      : LayoutDirectionPB.LTRLayout,
  );
  const locale = useI18nStore((s) => s.locale);

  const textDirectionLabel = tr('settings.workspacePage.textDirection.title');
  const rtlItemsLabel = tr('settings.workspacePage.textDirection.enableRTLItems');
  const layoutDirectionLabel = tr('settings.workspacePage.layoutDirection.title');
  const languageLabel = tr('settings.workspacePage.language.title');

  return (
    <SettingsSection id="appearance-text" title="Text & language">
      <SettingsRow
        title={textDirectionLabel}
        control={
          <OptionSelect
            label={textDirectionLabel}
            value={textDirection}
            options={TEXT_DIRECTIONS.map((direction) => ({ value: direction.value, label: tr(direction.label) }))}
            onChange={(next) => {
              const direction = TEXT_DIRECTIONS.find((item) => item.value === next);
              if (!direction) return;
              // Also DocumentAppearanceCubit.syncDefaultTextDirection.
              void appearanceActions.setTextDirection(direction.value);
              void KeyValueStorage.set(DocumentAppearanceKeys.defaultTextDirection, direction.name);
            }}
          />
        }
      />
      <SettingsRow
        title={rtlItemsLabel}
        control={
          <Switch
            checked={enableRtlItems}
            onCheckedChange={(checked) => void appearanceActions.setEnableRtlToolbarItems(Boolean(checked))}
            aria-label={rtlItemsLabel}
          />
        }
      />
      <SettingsRow
        title={layoutDirectionLabel}
        control={
          <OptionSelect
            label={layoutDirectionLabel}
            value={layoutDirection}
            options={[
              { value: LayoutDirectionPB.LTRLayout, label: tr('settings.workspacePage.layoutDirection.leftToRight') },
              { value: LayoutDirectionPB.RTLLayout, label: tr('settings.workspacePage.layoutDirection.rightToLeft') },
            ]}
            onChange={(next) => void appearanceActions.setLayoutDirection(next)}
          />
        }
      />
      <SettingsRow
        title={languageLabel}
        control={
          <OptionSelect
            label={languageLabel}
            value={locale as string}
            options={FLUTTER_SUPPORTED_LOCALES.map((value) => ({
              value: value as string,
              label: languageFromLocale(value),
            }))}
            onChange={(next) => void appearanceActions.setLocale(next)}
          />
        }
      />
    </SettingsSection>
  );
}

// ---- Document ----------------------------------------------------------------------------

/** _DocumentCursorColorSetting / _DocumentSelectionColorSetting. */
function DocumentColorRow({ kind }: { kind: 'cursor' | 'selection' }) {
  const { tr } = useTr();
  const scheme = useCurrentScheme();
  const key = kind === 'cursor' ? DocumentAppearanceKeys.cursorColor : DocumentAppearanceKeys.selectionColor;
  const [stored, setStored] = useState(() => KeyValueStorage.get(key));
  // DefaultAppearanceSettings: primary, or primary at alpha 0.2 for the selection.
  const fallback =
    kind === 'cursor' ? cssToHexString(scheme.primary) : `0x33${cssToHexString(scheme.primary).slice(4)}`;
  const current = stored ?? fallback;
  const label = tr(
    kind === 'cursor'
      ? 'settings.appearance.documentSettings.cursorColor'
      : 'settings.appearance.documentSettings.selectionColor',
  );
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
        <span className="text-sm text-foreground">{tr('settings.appearance.documentSettings.hyper')}</span>
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
    <SettingsRow
      title={label}
      resetAction={
        stored !== null && stored !== undefined ? (
          <SettingResetButton
            label={label.toLowerCase()}
            onClick={() =>
              showConfirmDialog({
                title: tr(
                  kind === 'cursor'
                    ? 'settings.workspacePage.resetCursorColor.title'
                    : 'settings.workspacePage.resetSelectionColor.title',
                ),
                description: tr(
                  kind === 'cursor'
                    ? 'settings.workspacePage.resetCursorColor.description'
                    : 'settings.workspacePage.resetSelectionColor.description',
                ),
                style: 'cancelAndOk',
                confirmLabel: tr('settings.common.reset'),
                onConfirm: () => void apply(null),
              })
            }
          />
        ) : null
      }
      control={
        <DocumentColorSettingButton
          key={current}
          current={current}
          preview={preview}
          dialogTitle={label}
          onApply={(hex) => void apply(hex)}
        />
      }
    />
  );
}

/** DocumentPaddingSetting: width slider 480–1920 in 10 divisions; reset without confirm. */
function DocumentWidthRow() {
  const { tr } = useTr();
  const read = () => {
    const value = Number(KeyValueStorage.get(DocumentAppearanceKeys.width));
    return Number.isFinite(value) && value > 0
      ? Math.min(MAX_DOCUMENT_WIDTH, Math.max(MIN_DOCUMENT_WIDTH, value))
      : MAX_DOCUMENT_WIDTH;
  };
  const [width, setWidth] = useState(read);
  /** syncWidth: SharedPreferences.setDouble (a JSON number in shared_preferences.json). */
  const sync = (value: number) => {
    const clamped = Math.min(MAX_DOCUMENT_WIDTH, Math.max(MIN_DOCUMENT_WIDTH, value));
    setWidth(clamped);
    // A number, not KeyValueStorage's string, as setDouble writes.
    void window.hypertask.prefs.setDouble(DocumentAppearanceKeys.width, clamped);
  };
  const label = tr('settings.appearance.documentSettings.width');
  return (
    <SettingsRow
      title={label}
      resetAction={
        width !== MAX_DOCUMENT_WIDTH ? (
          <SettingResetButton label={label.toLowerCase()} onClick={() => sync(MAX_DOCUMENT_WIDTH)} />
        ) : null
      }
      control={
        <SettingsSlider
          label={label}
          id="document-width"
          value={Math.round(width)}
          min={MIN_DOCUMENT_WIDTH}
          max={MAX_DOCUMENT_WIDTH}
          step={(MAX_DOCUMENT_WIDTH - MIN_DOCUMENT_WIDTH) / 10}
          unit=" px"
          badgeClassName="min-w-16"
          onChange={sync}
        />
      }
    />
  );
}

export function HyperDocumentSection() {
  return (
    <SettingsSection id="appearance-document" title="Document">
      <DocumentColorRow kind="cursor" />
      <DocumentColorRow kind="selection" />
      <DocumentWidthRow />
    </SettingsSection>
  );
}

// ---- Date & time -------------------------------------------------------------------------

/** DateTime.now().timeZoneName (the Windows long name, e.g. "Israel Standard Time"). */
function timeZoneName(date: Date): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'long' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? '';
}

const DATE_FORMATS: Array<{ value: UserDateFormatPB; label: string }> = [
  { value: UserDateFormatPB.Locally, label: 'settings.workspacePage.dateTime.dateFormat.local' },
  { value: UserDateFormatPB.US, label: 'settings.workspacePage.dateTime.dateFormat.us' },
  { value: UserDateFormatPB.ISO, label: 'settings.workspacePage.dateTime.dateFormat.iso' },
  { value: UserDateFormatPB.Friendly, label: 'settings.workspacePage.dateTime.dateFormat.friendly' },
  { value: UserDateFormatPB.DayMonthYear, label: 'settings.workspacePage.dateTime.dateFormat.dmy' },
];

export function HyperDateTimeSection() {
  const { tr } = useTr();
  const { dateFormat, timeFormat } = useAppearanceStore((s) => s.dateTime);
  const now = new Date();
  const hourLabel = tr('settings.workspacePage.dateTime.24HourTime');
  const dateFormatLabel = tr('settings.workspacePage.dateTime.dateFormat.label');
  return (
    <SettingsSection id="appearance-date-time" title={tr('settings.workspacePage.dateTime.title')}>
      <SettingsRow
        title={hourLabel}
        control={
          <Switch
            checked={timeFormat === UserTimeFormatPB.TwentyFourHour}
            onCheckedChange={(checked) =>
              void appearanceActions.setTimeFormat(
                checked ? UserTimeFormatPB.TwentyFourHour : UserTimeFormatPB.TwelveHour,
              )
            }
            aria-label={hourLabel}
          />
        }
      />
      <SettingsRow
        title={dateFormatLabel}
        description={tr('settings.workspacePage.dateTime.example', {
          args: [formatDate(now, dateFormat, false), formatTime(now, timeFormat), timeZoneName(now)],
        })}
        control={
          <OptionSelect
            label={dateFormatLabel}
            value={dateFormat}
            options={DATE_FORMATS.map((format) => ({ value: format.value, label: tr(format.label) }))}
            onChange={(next) => void appearanceActions.setDateFormat(next)}
          />
        }
      />
    </SettingsSection>
  );
}
