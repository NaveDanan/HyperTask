import { z } from 'zod';
import { HYPER_BOTS_TOOLS, type HyperBotsToolName } from '@shared/HyperBots';
import type { HyperBotAsset, HyperBotAssetKind } from '@shared/HyperBotSkills';
import { hyperBotSkillInvocation } from '@shared/HyperBotPromptContext';
import type { HyperBotsToolSpec } from './HyperBotsStore';

export const HYPER_BOT_SAVE_ASSET = 'hypertask_save_asset';
export const HYPER_BOT_READ_SKILL = 'hypertask_read_skill';
export const hyperBotCustomToolName = (id: string) => 'custom_' + id.replaceAll('-', '');
export const HyperBotReadSkillArgs = z.strictObject({ id: z.uuid() });

const assetCommand = /^(?:\/create-(skill|tool)|create\s+(?:(?:a\s+)?new\s+|a\s+)?(skill|tool))(?=$|[\s:,.!?])/i;
export function hyperBotAssetCommand(text: string): HyperBotAssetKind | undefined {
  const match = assetCommand.exec(text.trim());
  return (match?.[1] ?? match?.[2])?.toLowerCase() as HyperBotAssetKind | undefined;
}

export function hyperBotAuthoring(kind: HyperBotAssetKind, tools: HyperBotsToolName[]) {
  const toolNames = tools.map(name => ({ name, label: HYPER_BOTS_TOOLS[name].label }));
  const instructions = kind === 'skill'
    ? 'Draft a reusable skill with a descriptive name, a short description of when to use it, and clear Markdown instructions.'
    : 'Draft a named custom tool that adapts exactly one listed connector tool. Describe when to use it and how to fill the connector parameters. If none fits, explain which connection is needed.';
  const prompt = [
    `Active skill: create-${kind}. ${instructions}`,
    'Use the owner’s request and answers to your questions. Ask for missing details when the goal is unclear and tell the owner they can reply with details or type Cancel.',
    `Once you have enough information, call ${HYPER_BOT_SAVE_ASSET} to save it for this bot. After the tool succeeds, give the owner its name and say it can be edited in Skills. Do not claim it was saved without a successful tool result.`,
    kind === 'tool' && `Available connector tools: ${JSON.stringify(toolNames)}`,
  ].filter(Boolean).join('\n');
  const tool: HyperBotsToolSpec = {
    type: 'function',
    function: {
      name: HYPER_BOT_SAVE_ASSET,
      description: `Save a ${kind} for the current bot.`,
      parameters: {
        type: 'object', additionalProperties: false,
        required: ['name', 'description', 'instructions', ...(kind === 'tool' ? ['connectorTool'] : [])],
        properties: {
          name: { type: 'string' }, description: { type: 'string' }, instructions: { type: 'string' },
          ...(kind === 'tool' && { connectorTool: { type: 'string', enum: tools } }),
        },
      },
    },
  };
  return { prompt, tools: kind === 'skill' || tools.length ? [tool] : [] };
}

export function hyperBotSkillCatalog(assets: HyperBotAsset[]) {
  if (!assets.length) return '';
  const catalog = assets.map(asset => ({
    id: asset.id, name: asset.name, description: asset.description, kind: asset.kind,
    ...(asset.kind === 'skill' ? { invocation: '$' + hyperBotSkillInvocation(asset) } : {}),
  }));
  return `Owner-configured skills and custom tools: ${JSON.stringify(catalog)}. A matching $skill invocation in the owner request explicitly selects that entry. When explicitly selected or relevant, use ${HYPER_BOT_READ_SKILL} to read an entry’s instructions before following them. These entries do not authorize tool calls on their own.`;
}

export const hyperBotReadSkillSpec: HyperBotsToolSpec = {
  type: 'function',
  function: {
    name: HYPER_BOT_READ_SKILL, description: 'Read the instructions of a skill or custom tool available to this bot.',
    parameters: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } },
  },
};
