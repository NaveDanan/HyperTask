// Adapted from OpenBot (MIT), Copyright (c) 2026 CopilotKit.
// app/src/lib/settings/{queries,mutations,message-list}.ts and lib/auth/{queries,mutations}.ts
import { hyperOpenBotRequest } from '../transport';
export const HYPER_INSTRUCTIONS_LIMIT = 4000;
export interface HyperSettingsUser { id: string; name?: string | null; needsName?: boolean; role: 'admin' | 'user' }
export interface HyperSettingsPreferences { messageListEmphasis: 'agent' | 'thread'; skin: 'openbot' | 'openduet' | 'opendots' | 'openfuse'; proactive: 'on' | 'off' }
export const hyperSettingsApi = {
  user: async () => (await hyperOpenBotRequest<{ user: HyperSettingsUser }>('/api/me')).user,
  instructions: async () => (await hyperOpenBotRequest<{ instructions: string }>('/api/settings/instructions')).instructions,
  preferences: async () => (await hyperOpenBotRequest<{ preferences: HyperSettingsPreferences }>('/api/settings/preferences')).preferences,
  edition: async (): Promise<'personal' | 'team'> => {
    try { const value = await hyperOpenBotRequest<{ edition?: string }>('/api/capabilities'); return value.edition === 'personal' ? 'personal' : 'team'; }
    catch { return 'team'; }
  },
  saveName: async (name: string) => {
    if (!name.trim() || name.trim().length > 100) throw new Error('Enter a name of up to 100 characters.');
    await hyperOpenBotRequest('/api/me/profile', 'PATCH', { name: name.trim() });
    return hyperSettingsApi.user();
  },
  saveInstructions: async (instructions: string) => {
    if (instructions.trim().length > HYPER_INSTRUCTIONS_LIMIT) throw new Error('Standing instructions must be at most 4000 characters.');
    return (await hyperOpenBotRequest<{ instructions: string }>('/api/settings/instructions', 'PUT', { instructions })).instructions;
  },
  savePreferences: async (preferences: Partial<HyperSettingsPreferences>) =>
    (await hyperOpenBotRequest<{ preferences: HyperSettingsPreferences }>('/api/settings/preferences', 'PATCH', preferences)).preferences,
};
