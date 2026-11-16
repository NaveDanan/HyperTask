import { useEffect, useRef, useState } from 'react';
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
import { Eye, EyeOff } from 'lucide-react';

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
  const [url, setUrl] = useState('');
  const [model, setModel] = useState('');
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

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const settings = await loadEndpointSettings();
        if (!mounted.current) return;
        setUrl(settings?.baseUrl ?? '');
        setModel(settings?.model ?? '');
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
      const current = await settings();
      if (test) {
        await testEndpointConnection(current);
      } else {
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
              <Field><FieldLabel htmlFor="hyper-ai-url">API base URL</FieldLabel><Input spellCheck={false} autoComplete="off" id="hyper-ai-url" type="url" className="font-mono text-xs" placeholder="http://localhost:8000/v1" value={url} disabled={busy} onChange={(event) => setUrl(event.target.value)} /><FieldDescription className="text-xs">Include the API prefix, usually /v1.</FieldDescription></Field>
              <Field><FieldLabel htmlFor="hyper-ai-model">Chat model ID</FieldLabel><Input spellCheck={false} autoComplete="off" id="hyper-ai-model" value={model} disabled={busy} onChange={(event) => setModel(event.target.value)} /><FieldDescription className="text-xs">Use the exact model ID provided by your endpoint.</FieldDescription></Field>
              <Field><FieldLabel htmlFor="hyper-ai-embedding">Embeddings model ID (optional)</FieldLabel><Input spellCheck={false} autoComplete="off" id="hyper-ai-embedding" value={embedding} disabled={busy} onChange={(event) => setEmbedding(event.target.value)} /><FieldDescription className="text-xs">Leave empty for local text search. Semantic search sends workspace document text to this endpoint.</FieldDescription></Field>
              <Field><FieldLabel htmlFor="hyper-ai-image">Image generation model ID (optional)</FieldLabel><Input spellCheck={false} autoComplete="off" id="hyper-ai-image" value={imageModel} disabled={busy} onChange={(event) => setImageModel(event.target.value)} /><FieldDescription className="text-xs">Requires POST /images/generations. Generated images are saved locally. Image attachments use your chat model and require vision support.</FieldDescription></Field>
              <Field><FieldLabel htmlFor="hyper-ai-key">API key (optional)</FieldLabel>
                <InputGroup><InputGroupInput spellCheck={false} autoComplete="off" id="hyper-ai-key" type={obscured ? 'password' : 'text'} value={key} disabled={busy || removeKey} onChange={(event) => setKey(event.target.value)} />
                  <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label={obscured ? 'Show API key' : 'Hide API key'} onMouseDown={(event) => event.preventDefault()} onClick={() => setObscured(!obscured)}>{obscured ? <Eye /> : <EyeOff />}</InputGroupButton></InputGroupAddon>
                </InputGroup>
                <FieldDescription className="text-xs">{protectedKey === '' ? 'Leave empty if your endpoint does not require a key.' : 'A key is saved using Windows account encryption. Leave empty to keep it.'}</FieldDescription>
              </Field>
            </div>
            {protectedKey !== '' && <SettingsRow label={<label htmlFor="hyper-ai-remove-key" className="cursor-pointer">Remove saved API key</label>} control={<Checkbox id="hyper-ai-remove-key" aria-label="Remove saved API key" checked={removeKey} disabled={busy} onCheckedChange={setRemoveKey} />} />}
          </SettingsGroup>
          <p className="text-sm text-muted-foreground">Chat, editor actions, summaries, translations, and selected-source answers use this model. Retrieval uses local text search,
            or your optional embeddings model for semantic workspace search. Image output uses the optional image model. Unsupported image
            or vision requests show a capability error.</p>
          <div className="flex flex-wrap items-center gap-3"><Button disabled={busy} onClick={() => void act(false)}>Save AI settings</Button><Button variant="outline" disabled={busy} onClick={() => void act(true)}>Test endpoint</Button>{busy && <Spinner />}</div>
          {message !== null && <div aria-live="polite"><Alert variant={failed ? 'destructive' : 'success'}><AlertDescription>{message}</AlertDescription></Alert></div>}
        </>}
      </SettingsSection>
    </>
  );
}
