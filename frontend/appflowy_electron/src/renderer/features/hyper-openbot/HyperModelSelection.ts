// Adapted from OpenBot lib/models/effort.ts. Copyright (c) 2026 CopilotKit, MIT; see REUSE.md.
import { HyperAccepts, type HyperModelPick, type HyperModelOption } from './composer/hyper-models';

/** Original /channels/:id/model contract: null selects the catalogue's current default. */
export interface HyperConversationModel { model: string | null; effort: string | null }
export interface HyperModelCatalogue { models: HyperModelOption[]; default: string; choosable: boolean }
export function hyperResolveModelPick(saved: HyperConversationModel, defaultModel: string): HyperModelPick {
  return { model: saved.model ?? defaultModel, effort: saved.effort };
}
/** Match pinned requestFor: defaults and unsupported efforts are represented by null. */
export function hyperRequestModelPick(pick: HyperModelPick, catalogue: HyperModelCatalogue): HyperConversationModel {
  const option = catalogue.models.find(model => model.id === pick.model);
  return { model: pick.model === catalogue.default ? null : pick.model,
    effort: HyperAccepts(option, pick.effort) && pick.effort !== option?.defaultEffort ? pick.effort : null };
}
