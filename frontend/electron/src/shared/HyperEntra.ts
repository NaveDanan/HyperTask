import { z } from 'zod';
export const HyperEntraConfigSchema = z.object({ tenantId: z.guid(), clientId: z.guid() }).strict();
export type HyperEntraConfig = z.infer<typeof HyperEntraConfigSchema>;
export interface HyperEntraToken { idToken: string; name: string; nonce?: string }
export const HyperEntraConfigKey = 'hyper.entra.config.v1';
export const HyperEntraSignOutKey = 'hyper.entra.explicitSignOut.v1';
export const hyperEntraRedirectUri = (clientId: string) => 'ms-appx-web://Microsoft.AAD.BrokerPlugin/' + clientId;
