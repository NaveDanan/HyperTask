// Adapted from OpenBot (MIT), Copyright (c) 2026 CopilotKit.
// routes/_authed/settings/index.tsx; skins/skin-picker.tsx
import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { hyperSettingsApi, type HyperSettingsPreferences } from './HyperSettingsApi';
export function HyperSettingsAppearance({ preferences, onPreferences }: { preferences: HyperSettingsPreferences; onPreferences(value: HyperSettingsPreferences): void }) {
  const [dark, setDark] = useState(false); const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    let active = true; let unsubscribe = () => {};
    void import('@/theme/appearance-store').then(store => {
      if (!active) return;
      setDark(store.effectiveBrightness() === 'dark'); setReady(true);
      unsubscribe = store.useAppearanceStore.subscribe(() => setDark(store.effectiveBrightness() === 'dark'));
    });
    return () => { active = false; unsubscribe(); };
  }, []);
  return <section className="flex flex-col gap-3 rounded-lg border bg-card p-4"><h2 className="text-sm font-medium">Appearance</h2><div className="flex items-center justify-between"><label className="text-sm" htmlFor="hyper-settings-dark">Dark theme</label><Switch id="hyper-settings-dark" checked={dark} disabled={!ready || busy} onCheckedChange={async value => {
    setBusy(true); setError('');
    try { const [{ appearanceActions }, { ThemeModePB }] = await Promise.all([import('@/theme/appearance-store'), import('@shared/protobuf/flowy-user/user_setting_pb')]); await appearanceActions.setThemeMode(value ? ThemeModePB.Dark : ThemeModePB.Light); }
    catch { setError('Could not save appearance. Try again.'); } finally { setBusy(false); }
  }} /></div><label htmlFor="hyper-web-skin" className="text-sm">OpenBot web appearance</label><p className="text-xs text-muted-foreground">Saved to your OpenBot account for the web app. HyperTask uses its native layout.</p><select id="hyper-web-skin" className="rounded-md border bg-background p-2 text-sm" value={preferences.skin} disabled={busy} onChange={async event => {
    setBusy(true); setError(''); try { onPreferences(await hyperSettingsApi.savePreferences({ skin: event.target.value as HyperSettingsPreferences['skin'] })); } catch { setError('Could not save web appearance. Try again.'); } finally { setBusy(false); }
  }}><option value="openbot">OpenBot</option><option value="openduet">OpenDuet</option><option value="opendots">OpenDots</option><option value="openfuse">OpenFuse</option></select>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</section>;
}
