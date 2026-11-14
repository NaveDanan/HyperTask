import { expect, it, vi } from 'vitest';
import type { ReactElement, FormEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HyperSignInForm } from './HyperSignInForm';
import type { SignInRequest } from './HyperVaultApi';
const harness = vi.hoisted(() => ({ active: false, values: [] as unknown[], cursor: 0, answer: vi.fn() }));
vi.mock('./HyperVaultApi', () => ({hyperVaultApi: {answerSignIn: harness.answer}}));
vi.mock('react', async original => {
  const react = await original<typeof import('react')>();
  return {...react, useState: (value: unknown) => harness.active ? [harness.values[harness.cursor++] ?? value, vi.fn()] : react.useState(value), useEffect: (...args: Parameters<typeof react.useEffect>) => { if (!harness.active) react.useEffect(...args); }};
});
const base = {id:'request',botId:'bot',origin:'https://example.test',reason:null,status:'pending',outcome:null,passwordManager:true,savedLogins:[{id:'saved',username:'person'}]} as SignInRequest;
function tree(data: SignInRequest, error = '') {
  harness.active = true; harness.cursor = 0; harness.values = [data,error,false];
  try { return HyperSignInForm({requestId:'request',onOpenBrowser:vi.fn()}); } finally { harness.active = false; }
}
function findForm(node: unknown): ReactElement<{onSubmit: (event: FormEvent<HTMLFormElement>) => void}> | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const element = node as ReactElement<{children?: unknown}>;
  if (element.type === 'form') return element as ReturnType<typeof findForm>;
  for (const child of [element.props?.children].flat(Infinity)) { const found = findForm(child); if (found) return found; }
}
it('shows server-authoritative code, takeover and terminal states', () => {
  const code = renderToStaticMarkup(tree({...base,status:'code_required'}));
  expect(code).toContain('Verification code'); expect(code).not.toContain('name="password"');
  const takeover = renderToStaticMarkup(tree({...base,status:'taken_over'}));
  expect(takeover).toContain('Open the Bot'); expect(takeover).toContain('signed in'); expect(takeover).not.toContain('<form');
  for (const status of ['signed_in','failed','cancelled','expired'] as const) {
    const html = renderToStaticMarkup(tree({...base,status,outcome:'Server outcome'}));
    expect(html).toContain('Server outcome'); expect(html).not.toContain('<form');
  }
});
it('offers saved-login confirmation and honours disabled password saving', () => {
  expect(renderToStaticMarkup(tree(base))).toContain('Confirm and sign in');
  expect(renderToStaticMarkup(tree({...base,passwordManager:false}))).not.toContain('Save to Vault');
  expect(renderToStaticMarkup(tree(base,'Permission refused'))).toContain('role="alert"');
});
it('clears the real login form before sending and never persists browser data', () => {
  const write = vi.fn(); const reset = vi.fn();
  vi.stubGlobal('localStorage',{setItem:write}); vi.stubGlobal('sessionStorage',{setItem:write}); vi.stubGlobal('indexedDB',{open:write});
  vi.stubGlobal('FormData', class { get(key: string) { return ({username:'person',password:'synthetic-value',save:'on'} as Record<string,string>)[key]; } });
  harness.answer.mockImplementation(() => { expect(reset).toHaveBeenCalledOnce(); return Promise.resolve({...base,status:'filling'}); });
  try {
    findForm(tree(base))!.props.onSubmit({preventDefault:vi.fn(),currentTarget:{reset}} as unknown as FormEvent<HTMLFormElement>);
    expect(harness.answer).toHaveBeenCalledWith('request','submit',{username:'person',password:'synthetic-value',save:true});
    expect(write).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
