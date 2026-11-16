import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { HyperEntraBroker } from './HyperEntraBroker';
const config = { tenantId: '11111111-1111-4111-8111-111111111111', clientId: '22222222-2222-4222-8222-222222222222' };
const result = { idToken: 'fake-token', account: { name: 'Test Employee' }, tenantId: config.tenantId, idTokenClaims: { aud: config.clientId } };
function setup() { const client = { acquireTokenSilent: vi.fn().mockResolvedValue(result), acquireTokenInteractive: vi.fn().mockResolvedValue(result) }; const create = vi.fn().mockResolvedValue(client); return { client, create, broker: new HyperEntraBroker(create) }; }
describe('Hyper Entra broker', () => {
  it('uses the default Windows account and OIDC scopes without a browser', async () => {
    const {client,broker}=setup(); expect(await broker.idToken(config)).toEqual({idToken:'fake-token',name:'Test Employee'});
    expect(client.acquireTokenSilent).toHaveBeenCalledWith(expect.objectContaining({scopes:['openid','profile','email'],account:expect.not.objectContaining({nativeAccountId:expect.anything()})}));
    expect(client.acquireTokenInteractive).not.toHaveBeenCalled();
  });
  it('falls back only for interaction errors and parents the native picker', async () => {
    const {client,broker}=setup(); client.acquireTokenSilent.mockRejectedValue({errorCode:'interaction_required'});
    const handle=Buffer.from([1,2]); await broker.idToken(config,handle);
    const request=client.acquireTokenInteractive.mock.calls[0][0]; expect(request.windowHandle).toBe(handle); await expect(request.openBrowser('https://example.test')).rejects.toThrow('Native broker required');
  });
  it('sanitizes broker diagnostics and never launches interaction for an outage', async () => {
    const {client,broker}=setup(); client.acquireTokenSilent.mockRejectedValue(new Error('SECRET_TOKEN'));
    await expect(broker.idToken(config)).rejects.toThrow('Windows company sign-in failed'); expect(client.acquireTokenInteractive).not.toHaveBeenCalled();
  });
  it('rejects invalid IDs before creating MSAL', async () => {
    const {create,broker}=setup(); await expect(broker.idToken({...config,clientId:'invalid'})).rejects.toThrow('not configured'); expect(create).not.toHaveBeenCalled();
  });
  it('rejects a different tenant, audience or nonce', async () => {
    for (const change of [{tenantId:'wrong'}, {idTokenClaims:{aud:'wrong'}}, {idTokenClaims:{aud:config.clientId,nonce:'wrong'}}]) {
      const {client,broker}=setup(); client.acquireTokenSilent.mockResolvedValue({...result,...change}); await expect(broker.idToken(config)).rejects.toThrow();
    }
  });
  it('supplies GoTrue the preimage only for a matching hashed nonce', async () => {
    const {client,broker}=setup(); client.acquireTokenSilent.mockImplementation(async request=>({...result,idTokenClaims:{aud:config.clientId,nonce:request.extraQueryParameters.nonce}}));
    const token=await broker.idToken(config); expect(createHash('sha256').update(token.nonce!).digest('hex')).toBe(client.acquireTokenSilent.mock.calls[0][0].extraQueryParameters.nonce);
  });
  it('discards late results and prevents concurrent native pickers', async () => {
    const {client,broker}=setup(); let finish!:(value:unknown)=>void; client.acquireTokenSilent.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
    const pending=broker.idToken(config); await Promise.resolve(); await expect(broker.idToken(config)).rejects.toThrow('still finishing'); broker.cancel(); finish(result); await expect(pending).rejects.toThrow('cancelled'); expect(client.acquireTokenInteractive).not.toHaveBeenCalled();
  });
});
