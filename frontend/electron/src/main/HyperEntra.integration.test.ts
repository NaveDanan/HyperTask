import { expect, it } from 'vitest';
import { HyperEntraBroker } from './HyperEntraBroker';
it.skipIf(process.env.HYPER_ENTRA_IT !== '1' || process.platform !== 'win32')('acquires an ID token only for the explicitly provided company app registration', async () => {
  const tenantId=process.env.HYPER_ENTRA_TENANT_ID, clientId=process.env.HYPER_ENTRA_CLIENT_ID;
  if (!tenantId || !clientId) throw new Error('HYPER_ENTRA_TENANT_ID and HYPER_ENTRA_CLIENT_ID are required. No substitute application is used.');
  const token=await new HyperEntraBroker().idToken({tenantId,clientId}); expect(token.idToken.length).toBeGreaterThan(20); expect(typeof token.name).toBe('string');
},120000);
