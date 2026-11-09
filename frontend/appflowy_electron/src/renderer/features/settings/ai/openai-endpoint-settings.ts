import type { IpcResult } from '@shared/api';
import { validateEndpoint } from '@shared/openai-endpoint';
import { AIEventGetLocalAISetting, AIEventUpdateLocalAISetting } from '@/backend/events';

// OpenAIEndpointSettings (lib/ai/service/openai_endpoint_settings.dart) [CUSTOM]. The settings
// file is `<appSupport>/local_ai/openai-endpoint.json`; the API key is stored only as base64
// of a raw Windows DPAPI blob (the Rust core decrypts it per request).

export const openAIConfigPrefix = 'openai+file:';

export interface OpenAIEndpointSettings {
  baseUrl: string;
  model: string;
  embeddingModel: string;
  imageModel: string;
  /** DPAPI-protected key (base64), never the plaintext. */
  protectedKey: string;
  enabled: boolean;
}

/** Dart FormatException / StateError: the page shows their message as is. */
export class SettingsError extends Error {
  constructor(
    message: string,
    readonly kind: 'format' | 'state' | 'other' = 'other',
  ) {
    super(message);
  }
}

/** toJson(): the key order of the Dart map, compact as jsonEncode. */
export function endpointSettingsToJson(settings: OpenAIEndpointSettings): string {
  return JSON.stringify({
    base_url: settings.baseUrl,
    model: settings.model,
    embedding_model: settings.embeddingModel,
    image_model: settings.imageModel,
    protected_key: settings.protectedKey,
    enabled: settings.enabled,
  });
}

/** fromJson(): base_url and model are required strings; the other keys default. */
export function endpointSettingsFromJson(text: string): OpenAIEndpointSettings {
  const json = JSON.parse(text) as Record<string, unknown>;
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new TypeError('not a map');
  const str = (key: string, required: boolean): string => {
    const value = json[key];
    if (typeof value === 'string') return value;
    if (!required && (value === undefined || value === null)) return '';
    throw new TypeError(`${key} is not a String`);
  };
  const enabled = json.enabled;
  if (enabled !== undefined && enabled !== null && typeof enabled !== 'boolean') throw new TypeError('enabled is not a bool');
  return {
    baseUrl: str('base_url', true),
    model: str('model', true),
    embeddingModel: str('embedding_model', false),
    imageModel: str('image_model', false),
    protectedKey: str('protected_key', false),
    enabled: enabled ?? false,
  };
}

/** validate(): throws a 'format' SettingsError with the Dart message. */
export function validateEndpointSettings(settings: OpenAIEndpointSettings): void {
  try {
    validateEndpoint(settings.baseUrl, settings.model);
  } catch (error) {
    throw new SettingsError(error instanceof Error ? error.message : String(error), 'format');
  }
}

function unwrapIpc<T>(result: IpcResult<T>): T {
  if (result.ok) return result.value;
  throw new SettingsError(result.message, result.kind === 'format' || result.kind === 'state' ? result.kind : 'other');
}

/** encryptKey(): '' stays ''. */
export async function encryptKey(value: string): Promise<string> {
  if (value === '') return '';
  return unwrapIpc(await window.appflowy.dpapi.protect(value));
}

/** OpenAIEndpointSettings.load(): null when the Rust pointer is not an endpoint file or it is missing. */
export async function loadEndpointSettings(): Promise<OpenAIEndpointSettings | null> {
  const result = await AIEventGetLocalAISetting();
  const pointer = result.ok ? result.value.serverUrl : '';
  if (!pointer.startsWith(openAIConfigPrefix)) return null;
  const path = pointer.slice(openAIConfigPrefix.length);
  if (!(await window.appflowy.fs.exists(path))) return null;
  const text = await window.appflowy.fs.readText(path);
  if (text === null) throw new Error('Could not read the settings file.');
  return endpointSettingsFromJson(text);
}

/**
 * save(): validate, write the file (before the backend call, as in Dart), then point the
 * Rust local-AI setting at it.
 */
export async function saveEndpointSettings(settings: OpenAIEndpointSettings): Promise<void> {
  validateEndpointSettings(settings);
  const path = unwrapIpc(await window.appflowy.aiEndpoint.writeSettings(endpointSettingsToJson(settings)));
  const result = await AIEventUpdateLocalAISetting({
    serverUrl: `${openAIConfigPrefix}${path}`,
    globalChatModel: settings.model,
    embeddingModelName: settings.embeddingModel,
  });
  if (!result.ok) throw new SettingsError(`Could not apply AI endpoint settings: ${result.error.msg}`, 'state');
}

/** testConnection(): runs in the main process (no redirects, 30 s timeouts). */
export async function testEndpointConnection(settings: OpenAIEndpointSettings): Promise<void> {
  validateEndpointSettings(settings);
  unwrapIpc(
    await window.appflowy.aiEndpoint.test({ baseUrl: settings.baseUrl, model: settings.model, protectedKey: settings.protectedKey }),
  );
}

/** The page's catch: FormatException/StateError → message, else the generic text. */
export function endpointErrorMessage(error: unknown): string {
  if (error instanceof SettingsError && (error.kind === 'format' || error.kind === 'state')) return error.message;
  return 'Could not apply settings. Check the endpoint and try again.';
}
