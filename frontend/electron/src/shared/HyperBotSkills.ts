import { z } from 'zod';
import { HYPER_BOTS_TOOLS, type HyperBotsToolName } from './HyperBots';

export const HyperBotAssetKind = z.enum(['skill', 'tool']);
export type HyperBotAssetKind = z.infer<typeof HyperBotAssetKind>;
const botId = z.string().regex(/^[a-z0-9-]{1,32}$/);
const details = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  instructions: z.string().trim().min(1).max(8000),
};
const skill = z.strictObject({ ...details, kind: z.literal('skill') });
const tool = z.strictObject({ ...details, kind: z.literal('tool'), connectorTool: z.enum(Object.keys(HYPER_BOTS_TOOLS) as HyperBotsToolName[]) });
export const HyperBotAssetDraft = z.discriminatedUnion('kind', [skill, tool]);
export type HyperBotAssetDraft = z.infer<typeof HyperBotAssetDraft>;
export const HyperBotAssetScope = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('global') }),
  z.strictObject({ kind: z.literal('dedicated'), botIds: z.array(botId).max(8) }),
]);
const assetFields = { id: z.uuid(), revision: z.int().min(1), scope: HyperBotAssetScope };
export const HyperBotAsset = z.discriminatedUnion('kind', [skill.extend(assetFields), tool.extend(assetFields)]);
export type HyperBotAsset = z.infer<typeof HyperBotAsset>;
export const HyperBotAssetUpdate = z.union([
  z.strictObject({ id: assetFields.id, revision: assetFields.revision, scope: HyperBotAssetScope, draft: HyperBotAssetDraft }),
  z.strictObject({ id: assetFields.id, revision: assetFields.revision, delete: z.literal(true) }),
]);
export type HyperBotAssetUpdate = z.infer<typeof HyperBotAssetUpdate>;
export const HYPER_BOT_ASSET_LIMIT = 50;
export type HyperBotSkillLibrary = {
  assets: HyperBotAsset[];
  bots: { id: string; name: string }[];
};

export function hyperBotUsesAsset(asset: HyperBotAsset, id: string) {
  return asset.scope.kind === 'global' || asset.scope.botIds.includes(id);
}
