import { useCallback, useEffect, useState } from 'react';
import type { HyperDesktopSettingsPatch, HyperDesktopSettingsSnapshot } from '@shared/HyperDesktop';
import { HYPER_DESKTOP_HOTKEY_LABEL } from '@shared/HyperDesktop';
import { Badge } from '@/components/reui/badge';
import { ShortcutKeys } from '@/components/app/shortcut';
import { useTr } from '@/i18n';
import { showToast } from '@/ui/toast';
import { SettingsPageContainer, SettingsRow, SettingsSection } from './appearance/appearance-layout';
import { Switch } from './appearance/HyperSettingsControls';

export const DEFAULT_DESKTOP_SETTINGS_SNAPSHOT: HyperDesktopSettingsSnapshot = {
  autoStart: true,
  closeToTray: true,
  autoStartSupported: true,
  autoStartApplied: false,
  hotkey: HYPER_DESKTOP_HOTKEY_LABEL,
  hotkeyRegistered: false,
};

function formatFallback(template: string, namedArgs?: Record<string, string | number>): string {
  if (!namedArgs) return template;
  let result = template;
  for (const [name, value] of Object.entries(namedArgs)) {
    result = result.split(`{${name}}`).join(String(value));
  }
  return result;
}

function useDesktopTr() {
  const { tr } = useTr();
  return useCallback(
    (key: string, fallback: string, namedArgs?: Record<string, string | number>) => {
      const value = tr(key, namedArgs ? { namedArgs } : undefined);
      return value === key ? formatFallback(fallback, namedArgs) : value;
    },
    [tr],
  );
}

export interface HyperDesktopSettingsViewProps {
  settings: HyperDesktopSettingsSnapshot;
  busy?: boolean;
  onUpdate: (patch: HyperDesktopSettingsPatch) => void;
}

export function HyperDesktopSettingsView({ settings, busy = false, onUpdate }: HyperDesktopSettingsViewProps) {
  const t = useDesktopTr();
  const autoStartTitle = t('hyperDesktop.autoStart.title', 'Start HyperTask with your OS');
  const closeToTrayTitle = t('hyperDesktop.closeToTray.title', 'Keep running in system tray when closed');

  const autoStartStatus = !settings.autoStartSupported
    ? t('hyperDesktop.autoStart.unsupported', 'Automatic OS startup is not supported on this platform.')
    : settings.autoStart && !settings.autoStartApplied
      ? t('hyperDesktop.autoStart.devNotice', 'Saved. OS login registration applies in the packaged desktop app.')
      : undefined;

  const hotkeyStatus = !settings.hotkeyRegistered
    ? (settings.hotkeyError ??
      t('hyperDesktop.voiceShortcut.conflictHint', 'Another application may be using {hotkey}.', {
        hotkey: settings.hotkey,
      }))
    : undefined;

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="desktop-startup"
        title={t('hyperDesktop.startupSectionTitle', 'Startup & Background')}
      >
        <SettingsRow
          id="desktop-auto-start"
          title={autoStartTitle}
          description={t(
            'hyperDesktop.autoStart.description',
            'Launch HyperTask automatically at sign-in in the background so your assistant is always ready.',
          )}
          status={autoStartStatus}
          control={
            <Switch
              aria-label={autoStartTitle}
              checked={settings.autoStart}
              disabled={busy || !settings.autoStartSupported}
              onCheckedChange={(checked) => onUpdate({ autoStart: Boolean(checked) })}
            />
          }
        />

        <SettingsRow
          id="desktop-close-to-tray"
          title={closeToTrayTitle}
          description={t(
            'hyperDesktop.closeToTray.description',
            'Closing the main window hides HyperTask to the system tray. Choose Quit HyperTask from the tray menu to exit.',
          )}
          control={
            <Switch
              aria-label={closeToTrayTitle}
              checked={settings.closeToTray}
              disabled={busy}
              onCheckedChange={(checked) => onUpdate({ closeToTray: Boolean(checked) })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        id="desktop-voice-shortcut"
        title={t('hyperDesktop.voiceShortcutSectionTitle', 'Global Hyper-Bot Voice Shortcut')}
      >
        <SettingsRow
          id="desktop-voice-hotkey"
          title={t('hyperDesktop.voiceShortcut.title', 'Voice Assistant Hotkey')}
          description={t(
            'hyperDesktop.voiceShortcut.description',
            'Press {hotkey} anywhere—even when HyperTask is hidden in the tray—to open the floating voice sphere.',
            { hotkey: settings.hotkey },
          )}
          status={hotkeyStatus}
          control={
            <div className="flex items-center gap-2">
              <ShortcutKeys keys={settings.hotkey} />
              <Badge variant={settings.hotkeyRegistered ? 'success-light' : 'warning-light'} size="sm">
                {settings.hotkeyRegistered
                  ? t('hyperDesktop.voiceShortcut.registered', 'Active')
                  : t('hyperDesktop.voiceShortcut.unavailable', 'Unavailable')}
              </Badge>
            </div>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

/** Desktop settings page: OS auto-start (default ON), background close-to-tray, and global voice hotkey status. */
export function HyperDesktopSettingsSection() {
  const [settings, setSettings] = useState<HyperDesktopSettingsSnapshot>(DEFAULT_DESKTOP_SETTINGS_SNAPSHOT);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let alive = true;
    const desktop = window.hypertask?.desktop;
    if (!desktop?.getSettings) {
      setBusy(false);
      return;
    }
    void desktop
      .getSettings()
      .then((snapshot) => {
        if (alive && snapshot) setSettings(snapshot);
      })
      .catch(() => {
        /* Keep default snapshot when desktop bridge is unavailable. */
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleUpdate = useCallback((patch: HyperDesktopSettingsPatch) => {
    const desktop = window.hypertask?.desktop;
    if (!desktop?.setSettings) return;
    setBusy(true);
    setSettings((prev) => ({ ...prev, ...patch }));
    void desktop
      .setSettings(patch)
      .then((next) => {
        if (next) setSettings(next);
      })
      .catch((error: unknown) => {
        showToast({
          type: 'error',
          message: error instanceof Error ? error.message : 'Could not update desktop settings.',
        });
      })
      .finally(() => {
        setBusy(false);
      });
  }, []);

  return <HyperDesktopSettingsView settings={settings} busy={busy} onUpdate={handleUpdate} />;
}
