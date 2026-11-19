import { z } from 'zod';
import { endpointApiUrl } from '@shared/openai-endpoint';
import { HYPER_BOT_AUDIO_BYTES } from '@shared/HyperBots';
import { hyperBotsReadCapped, type HyperBotsEndpoint } from './HyperBotsEngine';
import { SettingsError } from './settings-error';

const extensions = { 'audio/webm': 'webm', 'audio/mp4': 'mp4' } as const;
export const HyperBotAudio = z.strictObject({
  type: z.enum(['audio/webm', 'audio/mp4']),
  data: z.instanceof(Uint8Array).refine(bytes => bytes.length > 0 && bytes.length <= HYPER_BOT_AUDIO_BYTES, 'Recording is empty or too large.'),
});
export type HyperBotAudio = z.infer<typeof HyperBotAudio>;

export async function hyperBotTranscribe(input: HyperBotAudio, endpoint: HyperBotsEndpoint, fetcher: typeof fetch, signal: AbortSignal): Promise<string> {
  const body = new FormData();
  body.set('model', 'whisper-1');
  body.set('file', new Blob([new Uint8Array(input.data)], { type: input.type }), 'recording.' + extensions[input.type]);
  try {
    const response = await fetcher(endpointApiUrl(endpoint.baseUrl, 'audio/transcriptions'), {
      method: 'POST', body, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      headers: endpoint.apiKey ? { authorization: 'Bearer ' + endpoint.apiKey } : {},
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new SettingsError('state', 'The configured AI endpoint refused transcription (HTTP ' + response.status + ').');
    }
    const result = z.object({ text: z.string().trim().min(1).max(20_000) }).safeParse(JSON.parse(await hyperBotsReadCapped(response)));
    if (!result.success) throw new SettingsError('format', 'The endpoint did not return a usable transcription.');
    signal.throwIfAborted();
    return result.data.text;
  } catch (error) {
    if (error instanceof SettingsError) throw error;
    throw new SettingsError('state', 'Transcription failed. Check the AI endpoint and try again.');
  }
}
