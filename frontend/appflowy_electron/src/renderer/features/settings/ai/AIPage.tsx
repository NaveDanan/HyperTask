import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useTr } from '@/i18n';
import type { SettingsPageProps } from '../page-props';
import { SettingsPageHeader, SettingsSection, SettingsGroup, SettingsRow } from '@/components/app/settings-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupInput, InputGroupAddon, InputGroupButton } from '@/components/ui/input-group';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
import { createHyperEndpointDiscovery } from './HyperEndpointDiscovery';
import { hyperEndpointStrings } from './HyperEndpointStrings';

import {
  encryptKey,
  endpointErrorMessage,
  loadEndpointSettings,
  saveEndpointSettings,
  testEndpointConnection,
  type OpenAIEndpointSettings,
} from './openai-endpoint-settings';


/**
 * LocalSettingsAIView → OpenAIEndpointSettingsView
 * (pages/setting_ai_view/openai_endpoint_settings_view.dart) [CUSTOM]. Hard-coded English, as
 * in Dart.
 */
export function AIPage(_: SettingsPageProps) {
  const { tr } = useTr();
  const t = (name: keyof typeof hyperEndpointStrings, values?: Record<string, string | number>) => {
    const path = `hyperEndpoint.${name}`, translated = tr(path, { namedArgs: values });
    return translated === path ? Object.entries(values ?? {}).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), hyperEndpointStrings[name] as string) : translated;
  };
  const [url, setUrl] = useState('');
  const [model, setModel] = useState('');
  const [modelQuery, setModelQuery] = useState('');
  const [discovery] = useState(() => createHyperEndpointDiscovery());
  const discoveryState = useStore(discovery);
  const [key, setKey] = useState('');
  const [obscured, setObscured] = useState(true);
  const [embedding, setEmbedding] = useState('');
  const [imageModel, setImageModel] = useState('');
  const [protectedKey, setProtectedKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [removeKey, setRemoveKey] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => discovery.start(), [discovery]);
  useEffect(() => {
    if (loading) return;
    discovery.update({ baseUrl: url, protectedKey: removeKey ? '' : protectedKey, apiKey: removeKey ? '' : key === '' ? undefined : key });
  }, [discovery, loading, url, protectedKey, key, removeKey]);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const settings = await loadEndpointSettings();
        if (!mounted.current) return;
        setUrl(settings?.baseUrl ?? '');
        setModel(settings?.model ?? '');
        setModelQuery(settings?.model ?? '');
        setEmbedding(settings?.embeddingModel ?? '');
        setImageModel(settings?.imageModel ?? '');
        setProtectedKey(settings?.protectedKey ?? '');
        setEnabled(settings?.enabled ?? false);
      } catch {
        setMessage('Could not load AI settings. Enter the endpoint settings again.');
        setFailed(true);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
      // _key.clear() on dispose.
      setKey('');
    };
  }, []);

  /** _settings(): the key text is not trimmed; an empty field keeps the saved key. */
  const settings = async (): Promise<OpenAIEndpointSettings> => ({
    baseUrl: url.trim(),
    model: model.trim(),
    embeddingModel: embedding.trim(),
    imageModel: imageModel.trim(),
    enabled,
    protectedKey: removeKey ? '' : key === '' ? protectedKey : await encryptKey(key),
  });

  const act = async (test: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      if (test) {
        await testEndpointConnection({ baseUrl: url.trim(), model: model.trim(), embeddingModel: embedding.trim(), imageModel: imageModel.trim(), enabled, protectedKey: removeKey ? '' : protectedKey }, removeKey ? '' : key === '' ? undefined : key);
      } else {
        const current = await settings();
        await saveEndpointSettings(current);
        setProtectedKey(current.protectedKey);
        setKey('');
        setRemoveKey(false);
      }
      if (!mounted.current) return;
      setFailed(false);
      setMessage(test ? 'Endpoint responded successfully.' : 'AI settings saved. Reopen existing chats to refresh their model.');
    } catch (error) {
      if (!mounted.current) return;
      setFailed(true);
      setMessage(endpointErrorMessage(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <>
      <SettingsPageHeader title="AI" description="Use your own OpenAI-compatible API. Workspace storage stays local. AI prompts, selected sources, and enabled semantic-search inputs are sent only to this endpoint." />
      <SettingsSection>
        {loading ? <Spinner /> : <>
          <SettingsGroup>
            <SettingsRow label={<label htmlFor="hyper-ai-enabled" className="cursor-pointer">Enable AI endpoint</label>} control={<Switch id="hyper-ai-enabled" aria-label="Enable AI endpoint" checked={enabled} disabled={busy} onCheckedChange={setEnabled} />} />
            <div className="flex flex-col gap-4 p-4">
              <Field><FieldLabel htmlFor="hyper-ai-url">API base URL</FieldLabel><Input spellCheck={false} autoComplete="off" id="hyper-ai-url" type="url" className="font-mono text-xs" placeholder="http://localhost:8000/v1" value={url} disabled={busy} onChange={(event) => setUrl(event.target.value)} /><FieldDescription className="text-xs">Include the API prefix, usually /v1. {t('autoHelp')}</FieldDescription></Field>
              <Field><FieldLabel htmlFor="hyper-ai-key">API key (optional)</FieldLabel>
                <InputGroup><InputGroupInput spellCheck={false} autoComplete="off" id="hyper-ai-key" type={obscured ? 'password' : 'text'} value={key} disabled={busy || removeKey} onChange={(event) => setKey(event.target.value)} />
                  <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label={obscured ? 'Show API key' : 'Hide API key'} onMouseDown={(event) => event.preventDefault()} onClick={() => setObscured(!obscured)}>{obscured ? <Eye /> : <EyeOff />}</InputGroupButton></InputGroupAddon>
                </InputGroup>
                <FieldDescription className="text-xs">{protectedKey === '' ? 'Leave empty if your endpoint does not require a key.' : 'A key is saved using operating system encryption. Leave empty to keep it.'}</FieldDescription>
              </Field>
              <Field><FieldLabel htmlFor="hyper-ai-model">{t('defaultModel')}</FieldLabel>
                <Combobox items={discoveryState.models} value={model || null} inputValue={modelQuery} onInputValueChange={setModelQuery} onValueChange={value => { if (value) { setModel(value); setModelQuery(value); } }} disabled={busy}>
                  <ComboboxInput id="hyper-ai-model" spellCheck={false} autoComplete="off" placeholder={t('selectModel')} />
                  <ComboboxContent><ComboboxEmpty>{t('noMatch')}</ComboboxEmpty><ComboboxList>{(id: string) => <ComboboxItem key={id} value={id} className="font-mono text-xs">{id}</ComboboxItem>}</ComboboxList></ComboboxContent>
                </Combobox>
                <FieldDescription className="text-xs">{t('modelHelp')}</FieldDescription>
                {model && <p className="break-all text-xs text-muted-foreground">{t('currentDefault', { model })}</p>}
                {modelQuery.trim() && modelQuery.trim() !== model && <Button size="sm" variant="outline" className="self-start" disabled={busy} onClick={() => { setModel(modelQuery.trim()); setModelQuery(modelQuery.trim()); }}>{t('useManual')}</Button>}
                {discoveryState.status === 'ready' && model && !discoveryState.models.includes(model) && <FieldDescription className="text-xs">{t('notListed')}</FieldDescription>}
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <div role="status" aria-live="polite" className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
                  {discoveryState.status === 'loading' && <Spinner className="size-3" />}
                  {discoveryState.status === 'waiting' ? t('waiting') : discoveryState.status === 'loading' ? t('checking') : discoveryState.status === 'ready' ? discoveryState.models.length ? t('connected', { count: discoveryState.models.length }) : t('empty') : null}
                </div>
                <Button size="sm" variant="ghost" disabled={busy || !url.trim() || discoveryState.status === 'loading'} onClick={() => discovery.refresh()}><RefreshCw className="size-3" />{t('refresh')}</Button>
              </div>
              {discoveryState.error && <Alert variant="destructive"><AlertDescription>{discoveryState.error}</AlertDescription></Alert>}
              <Field><FieldLabel htmlFor="hyper-ai-embedding">Embeddings model ID (optional)</FieldLabel><Input spellCheck={false} autoComplete="off" id="hyper-ai-embedding" value={embedding} disabled={busy} onChange={(event) => setEmbedding(event.target.value)} /><FieldDescription className="text-xs">Leave empty for local text search. Semantic search sends workspace document text to this endpoint.</FieldDescription></Field>
              <Field><FieldLabel htmlFor="hyper-ai-image">Image generation model ID (optional)</FieldLabel><Input spellCheck={false} autoComplete="off" id="hyper-ai-image" value={imageModel} disabled={busy} onChange={(event) => setImageModel(event.target.value)} /><FieldDescription className="text-xs">Requires POST /images/generations. Generated images are saved locally. Image attachments use your chat model and require vision support.</FieldDescription></Field>
            </div>
            {protectedKey !== '' && <SettingsRow label={<label htmlFor="hyper-ai-remove-key" className="cursor-pointer">Remove saved API key</label>} control={<Checkbox id="hyper-ai-remove-key" aria-label="Remove saved API key" checked={removeKey} disabled={busy} onCheckedChange={setRemoveKey} />} />}
          </SettingsGroup>
          <p className="text-sm text-muted-foreground">{t('defaultDescription')} Chat, editor actions, summaries, translations, and selected-source answers use this model. Retrieval uses local text search,
            or your optional embeddings model for semantic workspace search. Image output uses the optional image model. Unsupported image
            or vision requests show a capability error.</p>
          <div className="flex flex-wrap items-center gap-3"><Button disabled={busy || (!!modelQuery.trim() && modelQuery.trim() !== model)} onClick={() => void act(false)}>Save AI settings</Button><Button variant="outline" disabled={busy || !model.trim()} onClick={() => void act(true)}>{t('selectedTest')}</Button>{busy && <Spinner />}</div>
          {message !== null && <div aria-live="polite"><Alert variant={failed ? 'destructive' : 'success'}><AlertDescription>{message}</AlertDescription></Alert></div>}
        </>}
      </SettingsSection>
    </>
  );
}
