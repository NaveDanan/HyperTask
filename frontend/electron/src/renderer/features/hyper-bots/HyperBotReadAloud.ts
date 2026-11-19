import { useEffect, useState } from 'react';

export function useHyperBotReadAloud() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [reading, setReading] = useState<string>();
  useEffect(() => {
    const speech = window.speechSynthesis;
    if (!speech) return;
    const load = () => setVoices(speech.getVoices().filter(voice => voice.localService));
    load();
    speech.addEventListener('voiceschanged', load);
    return () => { speech.removeEventListener('voiceschanged', load); speech.cancel(); };
  }, []);
  const read = (id: string, text: string) => {
    const speech = window.speechSynthesis;
    speech.cancel();
    if (reading === id) { setReading(undefined); return; }
    const lang = /[\u0590-\u05ff]/.test(text) ? 'he' : navigator.language.split('-')[0];
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 4000));
    utterance.voice = voices.find(voice => voice.lang.split('-')[0] === lang) ?? voices[0] ?? null;
    if (!utterance.voice) return;
    utterance.lang = utterance.voice.lang;
    setReading(id);
    const finish = () => setReading(current => current === id ? undefined : current);
    utterance.onend = finish;
    utterance.onerror = finish;
    speech.speak(utterance);
  };
  return { available: voices.length > 0, reading, read };
}
