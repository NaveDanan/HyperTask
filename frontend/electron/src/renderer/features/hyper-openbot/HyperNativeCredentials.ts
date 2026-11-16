import type { HyperCallbackKeyAction } from '@shared/api';
/** Only a closed action and Bot ID cross IPC. Native dialogs own the one-time key. */
export async function hyperCallbackKey(agentId: string, action: HyperCallbackKeyAction) {
  const result = await window.hypertask.hyperOpenBot.callbackKey({ agentId, action });
  if (result.status === 'failed' || result.status === 'refused') throw new Error('Callback key action could not be completed. Refresh the Bot before retrying.');
  return result;
}
