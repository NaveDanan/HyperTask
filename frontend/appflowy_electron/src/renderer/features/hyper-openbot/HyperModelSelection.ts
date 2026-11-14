import type { HyperModelPick } from './composer/hyper-models';

/** Original /channels/:id/model contract: null selects the catalogue's current default. */
export interface HyperConversationModel { model: string | null; effort: string | null }
export function hyperResolveModelPick(saved: HyperConversationModel, defaultModel: string): HyperModelPick {
  return { model: saved.model ?? defaultModel, effort: saved.effort };
}
