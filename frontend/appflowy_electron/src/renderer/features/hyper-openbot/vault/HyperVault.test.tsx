import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { hyperVaultApi } from './HyperVaultApi';
import HyperVaultSection, { HyperKeyForm } from './HyperVaultSection';
import { HyperSignInForm } from './HyperSignInForm';
const request = vi.hoisted(() => vi.fn());
vi.mock('../transport', () => ({ hyperOpenBotRequest: request }));
beforeEach(() => { request.mockReset(); });
it('uses exact credential contracts without a model key ID', async () => {
  request.mockResolvedValue({});
  await hyperVaultApi.createKey({kind:'model', provider:'openai', plaintext:'synthetic-test-value', metadata:{}});
  expect(request).toHaveBeenCalledWith('/api/admin/credentials','POST',{kind:'model',provider:'openai',plaintext:'synthetic-test-value',metadata:{}});
  await hyperVaultApi.revokeKey('a b'); expect(request).toHaveBeenLastCalledWith('/api/admin/credentials/a%20b/revoke','POST',undefined);
});
it('sends sign-in secrets only in bodies and never writes browser storage', async () => {
  const write = vi.fn(); vi.stubGlobal('localStorage', {setItem:write}); vi.stubGlobal('sessionStorage', {setItem:write}); vi.stubGlobal('indexedDB', {open:write});
  try {
    request.mockResolvedValue({});
    for (const [action, body] of [['submit',{password:'synthetic-test-value',save:false}],['code',{code:'synthetic-code'}],['use-saved',{loginId:'login'}]] as const) await hyperVaultApi.answerSignIn('id',action,body);
    expect(request.mock.calls.map(call => call[0])).toEqual(['/api/sign-in-requests/id/submit','/api/sign-in-requests/id/code','/api/sign-in-requests/id/use-saved']);
    expect(write).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
it('redacts secret-bearing server errors', async () => {
  request.mockImplementation(() => { throw new Error('echoed synthetic secret'); });
  await expect(hyperVaultApi.answerSignIn('id','submit',{password:'synthetic secret'})).rejects.toThrow('Vault request failed.');
  const failure = await hyperVaultApi.keys().catch(error => error as Error);
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).not.toContain('echoed');
});
it('renders loading and guarded team state without a secret field', () => {
  const html = renderToStaticMarkup(<HyperVaultSection />);
  expect(html).toContain('Loading saved logins'); expect(html).not.toContain('Add key'); expect(html).not.toContain('type="password"');
  expect(renderToStaticMarkup(<HyperSignInForm requestId="id" />)).toContain('Loading sign-in request');
});
it('warns before replacing the active model key', () => {
  const html = renderToStaticMarkup(<HyperKeyForm onSaved={() => {}} onCancel={() => {}} keys={{modelKey:{provider:'openai',keyId:'default'},credentials:[{id:'id',kind:'model',provider:'openai',keyId:'default',revokedAt:null}]}} />);
  expect(html).toContain('Saving replaces it'); expect(html).toContain('type="password"'); expect(html).not.toContain('value="synthetic');
});
