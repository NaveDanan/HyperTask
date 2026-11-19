// t3code navigates to its /settings/voice route; HyperTask opens the settings dialog on its Voice page.
import { openSettings } from '@/features/home/notifiers';
import { SettingsPage } from '@/features/settings/settings-dialog-store';

export function openVoiceSettings(): void {
  openSettings.emit(SettingsPage.voice);
}
