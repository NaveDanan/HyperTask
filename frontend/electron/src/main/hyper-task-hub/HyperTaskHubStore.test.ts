import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it, onTestFinished } from 'vitest';
import { disk, setup } from './HyperTaskHub.test-support';
import { HyperTaskHubStore } from './HyperTaskHubStore';

it('round-trips the ledger and setup in ciphertext under hashed partition names', ({ onTestFinished }) => {
  const d = disk(); onTestFinished(d.cleanup);
  const store = d.open();
  store.commit(() => true, s => { s.setup = { ...setup, aliases: ['private alias'] }; s.ledger.actionIds.a = 'stable'; });
  store.clearCache(() => true);
  expect(d.open().current.ledger.actionIds.a).toBe('stable');
  const files = readdirSync(d.directory, { recursive: true, encoding: 'utf8' });
  const file = files.find(f => f.endsWith('.enc'))!;
  expect(file).toMatch(/hyper_task_hub[\\/]users[\\/][a-f0-9]{64}[\\/][a-f0-9]{64}/);
  expect(readFileSync(path.join(d.directory, file)).includes(Buffer.from('private alias'))).toBe(false);
  expect(files.some(f => f.endsWith('.tmp'))).toBe(false);
  expect(d.open('another').current.setup).toBeNull();
  expect(d.open('account', 'another').current.setup).toBeNull();
});

it.each([false, true])('writes nothing when safe storage is unavailable or basic_text (%s)', basic => {
  const d = disk(); onTestFinished(d.cleanup);
  const store = new HyperTaskHubStore(d.directory, 'a', 'w', { ...d.encryption, isEncryptionAvailable: () => basic,
    getSelectedStorageBackend: () => 'basic_text' }, 'linux');
  expect(() => store.commit(() => true, s => { s.setup = setup; })).toThrow('OS encryption');
  expect(store.current.revision).toBe(0);
  expect(readdirSync(d.directory)).toEqual([]);
});

it('drops a transaction invalidated before rename', ({ onTestFinished }) => {
  const d = disk(); onTestFinished(d.cleanup);
  const store = d.open();
  let checks = 0;
  expect(store.commit(() => ++checks === 1, s => { s.setup = setup; })).toBe(false);
  expect(store.current.revision).toBe(0);
  expect(d.open().current.setup).toBeNull();
});

it('purges a disconnected Jira account across its workspaces and retains each personal ledger', ({ onTestFinished }) => {
  const d = disk(); onTestFinished(d.cleanup);
  for (const workspace of ['w1', 'w2']) {
    const store = d.open('account', workspace);
    store.bindJira('old-binding');
    store.commit(() => true, draft => {
      draft.setup = setup;
      draft.cache.jira = { records: [], cursor: 'sensitive cursor', status: { connectionId: 'jira', label: 'Jira', kind: 'jira',
        status: 'fresh', lastSuccess: null, coverage: [] } };
      draft.ledger.actionIds.fingerprint = 'stable';
    });
  }
  HyperTaskHubStore.reconcileJira(d.directory, 'account', d.encryption, '');
  for (const workspace of ['w1', 'w2']) {
    const state = d.open('account', workspace).current;
    expect(state.cache).toEqual({});
    expect(state.setup?.jiraProjects).toEqual([]);
    expect(state.ledger.actionIds.fingerprint).toBe('stable');
  }
});

it('clears only the replaced connection consent in each encrypted partition', ({ onTestFinished }) => {
  const d = disk(); onTestFinished(d.cleanup);
  for (const work of ['one','two']) {
    const store = d.open('account',work);
    store.bindJira('first-jira'); store.bindNewsletter('first-newsletter');
    store.commit(() => true, draft => { draft.setup = { ...setup, writeBack:{jira:true,newsletter:true} }; });
  }
  HyperTaskHubStore.reconcileJira(d.directory,'account',d.encryption,'new-jira');
  for (const work of ['one','two']) expect(d.open('account',work).current.setup?.writeBack).toEqual({jira:false,newsletter:true});
  HyperTaskHubStore.reconcileNewsletter(d.directory,'account',d.encryption,'');
  for (const work of ['one','two']) expect(d.open('account',work).current.setup?.writeBack).toEqual({jira:false,newsletter:false});
});
