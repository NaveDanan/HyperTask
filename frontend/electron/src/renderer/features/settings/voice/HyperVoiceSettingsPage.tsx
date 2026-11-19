import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { forgetMicrophone, microphoneEntryKey, moveMicrophone, preferMicrophone, rememberMicrophones, type MicrophoneEntry } from './HyperMicrophoneOrder';
import { readMicrophones, saveMicrophones } from './HyperVoicePreferences';

export function HyperVoiceSettingsPage() {
  const [order, setOrder] = useState(readMicrophones);
  const [error, setError] = useState('');
  const update = (entries: readonly MicrophoneEntry[]) => { saveMicrophones(entries); setOrder([...entries]); };
  useEffect(() => {
    let active = true;
    const refresh = () => { void navigator.mediaDevices?.enumerateDevices().then(devices => {
      if (!active) return;
      const next = rememberMicrophones(readMicrophones(), devices.filter(device => device.kind === 'audioinput'));
      saveMicrophones(next); setOrder([...next]);
    }).catch(() => {}); };
    refresh(); navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => { active = false; navigator.mediaDevices?.removeEventListener('devicechange', refresh); };
  }, []);
  const discover = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      update(rememberMicrophones(readMicrophones(), devices.filter(device => device.kind === 'audioinput')));
      setError('');
    } catch { setError('Could not access the microphone. Check microphone permissions and try again.'); }
  };
  return <div className="space-y-7"><div><h1 className="text-xl font-semibold">Voice</h1><p className="mt-1 text-sm text-muted-foreground">Configure voice input.</p></div>
    <section className="space-y-3"><h2 className="font-medium">Input</h2><div><h3 className="text-sm font-medium">Microphone</h3><p className="text-sm text-muted-foreground">The first available microphone is used when OpenBot records dictation for its transcription service. System speech recognition uses its own microphone setting.</p></div>
      <div className="space-y-2">{order.map((entry, index) => <div key={microphoneEntryKey(entry)} className="flex items-center gap-2 rounded-md border p-2 text-sm"><span className="min-w-0 flex-1 truncate">{entry.kind === 'default' ? 'System default' : entry.label || 'Microphone'}</span><Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => update(preferMicrophone(order, entry))}>Prefer</Button><Button type="button" variant="ghost" size="sm" disabled={index === 0} aria-label="Move microphone up" onClick={() => update(moveMicrophone(order, microphoneEntryKey(entry), -1))}>↑</Button><Button type="button" variant="ghost" size="sm" disabled={index === order.length - 1} aria-label="Move microphone down" onClick={() => update(moveMicrophone(order, microphoneEntryKey(entry), 1))}>↓</Button>{entry.kind === 'device' && <Button type="button" variant="ghost" size="sm" onClick={() => update(forgetMicrophone(order, microphoneEntryKey(entry)))}>Remove</Button>}</div>)}</div>
      <Button type="button" variant="outline" onClick={() => void discover()}>Find microphones</Button>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section><section className="space-y-2"><h2 className="font-medium">Transcription</h2><p className="text-sm text-muted-foreground">Dictation uses the transcription service configured for OpenBot, or the system speech recognition where available.</p></section></div>;
}

