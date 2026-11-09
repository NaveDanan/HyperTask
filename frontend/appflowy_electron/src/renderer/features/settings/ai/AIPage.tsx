import { useEffect, useRef, useState } from 'react';
import type { SettingsPageProps } from '../page-props';
import { SettingsBody } from '../shared';
import { CheckboxListTile, LinearProgress, MdButton, MdText, MdTextField, SwitchListTile } from '../material';
import {
  encryptKey,
  endpointErrorMessage,
  loadEndpointSettings,
  saveEndpointSettings,
  testEndpointConnection,
  type OpenAIEndpointSettings,
} from './openai-endpoint-settings';

const gap = (height: number, key: string) => <div key={key} style={{ height }} />;

/**
 * LocalSettingsAIView → OpenAIEndpointSettingsView
 * (pages/setting_ai_view/openai_endpoint_settings_view.dart) [CUSTOM]. Hard-coded English, as
 * in Dart. SettingsBody's autoSeparate puts a divider between every child, spacers included.
 */
export function AIPage(_: SettingsPageProps) {
  const [url, setUrl] = useState('');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
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

  const children = loading
    ? [<LinearProgress key="loading" />]
    : [
        <SwitchListTile key="enabled" title="Enable AI endpoint" value={enabled} disabled={busy} onChanged={setEnabled} />,
        gap(12, 'g1'),
        <MdTextField
          key="url"
          label="API base URL"
          hint="http://localhost:8000/v1"
          helper="Include the API prefix, usually /v1."
          type="url"
          value={url}
          disabled={busy}
          onChange={setUrl}
        />,
        gap(20, 'g2'),
        <MdTextField
          key="model"
          label="Chat model ID"
          helper="Use the exact model ID provided by your endpoint."
          value={model}
          disabled={busy}
          onChange={setModel}
        />,
        gap(20, 'g3'),
        <MdTextField
          key="embedding"
          label="Embeddings model ID (optional)"
          helper="Leave empty for local text search. Semantic search sends workspace document text to this endpoint."
          value={embedding}
          disabled={busy}
          onChange={setEmbedding}
        />,
        gap(20, 'g4'),
        <MdTextField
          key="image"
          label="Image generation model ID (optional)"
          helper="Requires POST /images/generations. Generated images are saved locally. Image attachments use your chat model and require vision support."
          value={imageModel}
          disabled={busy}
          onChange={setImageModel}
        />,
        gap(20, 'g5'),
        <MdTextField
          key="key"
          label="API key (optional)"
          helper={
            protectedKey === ''
              ? 'Leave empty if your endpoint does not require a key.'
              : 'A key is saved using Windows account encryption. Leave empty to keep it.'
          }
          obscure
          value={key}
          disabled={busy || removeKey}
          onChange={setKey}
        />,
        protectedKey !== '' && (
          <CheckboxListTile key="remove" title="Remove saved API key" value={removeKey} disabled={busy} onChanged={setRemoveKey} />
        ),
        gap(20, 'g6'),
        <MdText key="info">
          Chat, editor actions, summaries, translations, and selected-source answers use this model. Retrieval uses local text search,
          or your optional embeddings model for semantic workspace search. Image output uses the optional image model. Unsupported image
          or vision requests show a capability error.
        </MdText>,
        gap(20, 'g7'),
        <div key="actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <MdButton variant="filled" disabled={busy} onPressed={() => void act(false)}>
            Save AI settings
          </MdButton>
          <MdButton variant="outlined" disabled={busy} onPressed={() => void act(true)}>
            Test endpoint
          </MdButton>
        </div>,
        busy && gap(12, 'g8'),
        busy && <LinearProgress key="busy" />,
        message !== null && gap(12, 'g9'),
        message !== null && (
          <div key="message" aria-live="polite">
            <MdText color={failed ? 'var(--cs-error)' : undefined}>{message}</MdText>
          </div>
        ),
      ];

  return (
    <SettingsBody
      title="AI"
      description="Use your own OpenAI-compatible API. Workspace storage stays local. AI prompts, selected sources, and enabled semantic-search inputs are sent only to this endpoint."
    >
      {children}
    </SettingsBody>
  );
}
