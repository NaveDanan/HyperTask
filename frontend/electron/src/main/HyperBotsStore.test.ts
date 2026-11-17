import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { HYPER_BOTS_DEFAULT_SETTINGS } from '@shared/HyperBots';
import {
  HYPER_BOTS_DAMAGED_APPROVAL, HYPER_BOTS_DAMAGED_RUN, HYPER_BOTS_ORPHAN, HYPER_BOTS_RECOVER_ERROR, HYPER_BOTS_ROOM_MESSAGES, HyperBotsStore,
} from './HyperBotsStore';

const user = { kind: 'user' as const };
const msg = (roomId: string, clientMessageId: string, text = 'hi') =>
  ({ roomId, clientMessageId, author: user, text, model: null, runId: null, hop: 0 });
const runInput = (roomId = 'r1', triggerMessageId = 'm1') => ({ roomId, botId: 'b1', triggerMessageId, model: 'gpt-x', transcript: [{ role: 'user' as const, content: 'hi' }] });
const apprInput = (runId: string, toolCallId = 'c1') => ({
  runId, roomId: 'r1', botId: 'b1', toolCallId, tool: 'jira_create_issue', access: 'write' as const, args: { a: 1 },
  summary: 'Create issue', status: 'pending' as const, decidedBy: null,
});
const tempDir = () => mkdtempSync(join(tmpdir(), 'hyper-bots-store-'));

test('addMessage is idempotent per room and keeps original text', () => {
  const s = new HyperBotsStore(null);
  const a = s.addMessage(msg('r1', 'k1', 'first'));
  const b = s.addMessage(msg('r1', 'k1', 'second'));
  expect([a.created, b.created]).toEqual([true, false]);
  expect(b.message.id).toBe(a.message.id);
  expect(b.message.text).toBe('first');
  expect(s.listMessages('r1')).toHaveLength(1);
  const c = s.addMessage(msg('r2', 'k1', 'other room'));
  expect(c.created).toBe(true);
  expect(c.message.id).not.toBe(a.message.id);
  expect(s.getMessage(a.message.id)).toEqual(a.message);
  expect(s.findMessage('r1', 'k1')).toEqual(a.message);
  expect(a.message.author).toEqual(user);
});

test('listMessages orders oldest->newest, limit keeps last N, beforeSeqOf', () => {
  const s = new HyperBotsStore(null);
  const ids = Array.from({ length: 5 }, (_, i) => s.addMessage(msg('r1', `k${i}`, `t${i}`)).message.id);
  s.addMessage(msg('r2', 'x', 'noise'));
  expect(s.listMessages('r1').map((m) => m.text)).toEqual(['t0', 't1', 't2', 't3', 't4']);
  expect(s.listMessages('r1', { limit: 2 }).map((m) => m.text)).toEqual(['t3', 't4']);
  expect(s.listMessages('r1', { beforeSeqOf: ids[3] }).map((m) => m.text)).toEqual(['t0', 't1', 't2']);
  expect(s.listMessages('r1', { beforeSeqOf: ids[3], limit: 2 }).map((m) => m.text)).toEqual(['t1', 't2']);
  expect(s.listMessages('r1', { beforeSeqOf: 'missing' })).toEqual([]);
});

test('runs: create, update, model never changes, filters', () => {
  const s = new HyperBotsStore(null);
  const r = s.createRun(runInput());
  expect([r.status, r.steps, r.error]).toEqual(['queued', 0, null]);
  const u = s.updateRun(r.id, { status: 'running', steps: 2, model: 'other' } as never);
  expect([u.model, u.status, u.steps]).toEqual(['gpt-x', 'running', 2]);
  const t = s.updateRun(r.id, { transcript: [{ role: 'assistant', content: 'ok' }], error: 'x' });
  expect(t.transcript).toEqual([{ role: 'assistant', content: 'ok' }]);
  expect(t.error).toBe('x');
  const r2 = s.createRun(runInput('r2'));
  expect(s.listRuns().map((x) => x.id)).toEqual([r.id, r2.id]);
  expect(s.listRuns({ status: ['queued'] }).map((x) => x.id)).toEqual([r2.id]);
  expect(s.listRuns({ status: [] })).toEqual([]);
  expect(s.listRuns({ roomId: 'r1' }).map((x) => x.id)).toEqual([r.id]);
  expect(s.runsForMessage('m1')).toHaveLength(2);
  expect(() => s.updateRun('nope', { steps: 1 })).toThrow();
  // Returned records are copies: mutating them never touches the store.
  t.transcript.push({ role: 'user', content: 'tamper' });
  expect(s.getRun(r.id)!.transcript).toHaveLength(1);
});

test('approvals: dedupe and atomic CAS transitions', () => {
  const s = new HyperBotsStore(null);
  const run = s.createRun(runInput());
  const a = s.createApproval(apprInput(run.id));
  const b = s.createApproval({ ...apprInput(run.id), summary: 'changed' });
  expect([a.created, b.created]).toEqual([true, false]);
  expect(b.approval.id).toBe(a.approval.id);
  expect(b.approval.summary).toBe('Create issue');
  expect(a.approval.args).toEqual({ a: 1 });
  const ok = s.transitionApproval(a.approval.id, ['pending'], 'approved', { decidedBy: 'owner' });
  expect([ok?.status, ok?.decidedBy]).toEqual(['approved', 'owner']);
  expect(s.transitionApproval(a.approval.id, ['pending'], 'denied')).toBeNull();
  expect(s.transitionApproval(a.approval.id, [], 'denied')).toBeNull();
  expect(s.transitionApproval('missing', ['pending'], 'denied')).toBeNull();
  expect(s.getApproval(a.approval.id)?.status).toBe('approved');
  const done = s.transitionApproval(a.approval.id, ['approved'], 'done', { result: '{"ok":true}' });
  expect([done?.result, done?.decidedBy]).toEqual(['{"ok":true}', 'owner']);
  s.createApproval(apprInput(run.id, 'c2'));
  expect(s.listApprovals({ status: ['pending'] })).toHaveLength(1);
  expect(s.listApprovals({ runId: run.id })).toHaveLength(2);
  expect(s.listApprovals({ roomId: 'zz' })).toHaveLength(0);
});

test('recover resets executing approvals and running runs', () => {
  const s = new HyperBotsStore(null);
  const run = s.createRun(runInput());
  s.updateRun(run.id, { status: 'running' });
  const other = s.createRun(runInput());
  s.updateRun(other.id, { status: 'waiting_approval' });
  const a = s.createApproval({ ...apprInput(run.id), status: 'approved', decidedBy: 'policy' }).approval;
  s.transitionApproval(a.id, ['approved'], 'executing');
  s.createApproval(apprInput(run.id, 'c2'));
  expect(s.recover()).toEqual({ runs: 1, approvals: 1 });
  expect(s.getRun(run.id)?.status).toBe('queued');
  expect(s.getRun(other.id)?.status).toBe('waiting_approval');
  const r = s.getApproval(a.id)!;
  expect([r.status, r.error]).toEqual(['unknown', HYPER_BOTS_RECOVER_ERROR]);
  expect(s.recover()).toEqual({ runs: 0, approvals: 0 });
});

test('settings round-trip', () => {
  const s = new HyperBotsStore(null);
  expect(s.settings()).toBeNull();
  s.saveSettings(HYPER_BOTS_DEFAULT_SETTINGS);
  const got = s.settings()!;
  expect(got).toEqual(HYPER_BOTS_DEFAULT_SETTINGS);
  got.bots.length = 0;
  expect(s.settings()!.bots).toHaveLength(2);
});

test('JSON file: data survives reopen, writes are atomic (no tmp left)', () => {
  const dir = tempDir();
  const file = join(dir, 'nested', 'hyper-bots.json');
  try {
    let s = new HyperBotsStore(file);
    const m = s.addMessage(msg('r1', 'k1', 'persisted')).message;
    const run = s.createRun(runInput());
    s.updateRun(run.id, { status: 'running' });
    const ap = s.createApproval(apprInput(run.id)).approval;
    s.transitionApproval(ap.id, ['pending'], 'approved', { decidedBy: 'owner' });
    s.saveSettings(HYPER_BOTS_DEFAULT_SETTINGS);
    expect(readdirSync(join(dir, 'nested'))).toEqual(['hyper-bots.json']);
    s = new HyperBotsStore(file);
    expect(s.getMessage(m.id)).toEqual(m);
    expect(s.getRun(run.id)?.model).toBe('gpt-x');
    expect(s.getRun(run.id)?.status).toBe('running');
    expect(s.getApproval(ap.id)?.status).toBe('approved');
    expect(s.settings()).toEqual(HYPER_BOTS_DEFAULT_SETTINGS);
    expect(s.addMessage(msg('r1', 'k1', 'again')).created).toBe(false);
    // Sequence continues after reopen, so ordering stays stable.
    const next = s.addMessage(msg('r1', 'k2', 'later')).message;
    expect(s.listMessages('r1', { beforeSeqOf: next.id }).map((x) => x.text)).toEqual(['persisted']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('JSON file: a corrupt file is set aside and the store starts empty', () => {
  const dir = tempDir();
  const file = join(dir, 'hyper-bots.json');
  try {
    writeFileSync(file, '{"version":1,"seq":');
    const s = new HyperBotsStore(file);
    expect(s.listRuns()).toEqual([]);
    const aside = readdirSync(dir).filter((n) => n.startsWith('hyper-bots.json.corrupt-'));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dir, aside[0]), 'utf8')).toBe('{"version":1,"seq":');
    s.addMessage(msg('r1', 'k1'));
    expect(new HyperBotsStore(file).listMessages('r1')).toHaveLength(1);
    writeFileSync(file, JSON.stringify({ version: 2, messages: 'no' }));
    expect(new HyperBotsStore(file).listMessages('r1')).toEqual([]);
    expect(readdirSync(dir).filter((n) => n.includes('.corrupt-')).length).toBeGreaterThanOrEqual(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('JSON file: a failed write rolls the change back', () => {
  const dir = tempDir();
  const file = join(dir, 'hyper-bots.json');
  try {
    const s = new HyperBotsStore(file);
    s.addMessage(msg('r1', 'k1'));
    // A directory where the tmp file goes makes the write fail.
    rmSync(dir, { recursive: true, force: true });
    expect(() => s.addMessage(msg('r1', 'k2'))).toThrow();
    expect(s.listMessages('r1').map((m) => m.clientMessageId)).toEqual(['k1']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('messages are capped per room; finished runs of dropped messages go with them; live work is kept', () => {
  const s = new HyperBotsStore(null);
  const first = s.addMessage(msg('r1', 'k0', 't0')).message;
  const done = s.createRun(runInput('r1', first.id));
  s.updateRun(done.id, { status: 'done' });
  const ap = s.createApproval(apprInput(done.id)).approval;
  s.transitionApproval(ap.id, ['pending'], 'denied', { decidedBy: 'owner' });
  const second = s.addMessage(msg('r1', 'k1', 't1')).message;
  const live = s.createRun(runInput('r1', second.id));
  for (let i = 2; i < HYPER_BOTS_ROOM_MESSAGES + 2; i++) s.addMessage(msg('r1', `k${i}`, `t${i}`));
  s.addMessage(msg('r2', 'x'));
  const kept = s.listMessages('r1', { limit: 5000 });
  expect(kept).toHaveLength(HYPER_BOTS_ROOM_MESSAGES);
  // The live run's trigger stays; the oldest unpinned messages go instead.
  expect(kept.slice(0, 2).map((m) => m.text)).toEqual(['t1', 't3']);
  expect(s.listMessages('r2')).toHaveLength(1);
  expect(s.getRun(done.id)).toBeUndefined();
  expect(s.listApprovals({ runId: done.id })).toEqual([]);
  expect(s.getRun(live.id)?.status).toBe('queued');
});

test('JSON file: structurally invalid files are set aside; a damaged run is quarantined, never dropped silently', () => {
  const dir = tempDir();
  const file = join(dir, 'hyper-bots.json');
  try {
    for (const bad of [
      { version: 1, seq: 0, messages: [null], runs: [], approvals: [], settings: null },
      { version: 1, seq: 0, messages: [], runs: [7], approvals: [], settings: null },
      { version: 1, seq: 0, messages: [], runs: [], approvals: [7], settings: null },
      { version: 1, seq: 0, messages: [], runs: [], approvals: [], settings: [] },
    ]) {
      writeFileSync(file, JSON.stringify(bad));
      const s = new HyperBotsStore(file);
      expect(() => s.recover()).not.toThrow();
      expect(s.listRuns()).toEqual([]);
    }
    expect(readdirSync(dir).filter((n) => n.includes('.corrupt-')).length).toBeGreaterThanOrEqual(1);
    writeFileSync(file, JSON.stringify({ version: 1, seq: 0, messages: [], runs: [{ id: 'r', status: 'running' }], approvals: [], settings: null }));
    const s = new HyperBotsStore(file);
    expect(() => s.recover()).not.toThrow();
    expect(s.listRuns().map((r) => [r.id, r.status, r.error])).toEqual([['r', 'failed', HYPER_BOTS_DAMAGED_RUN]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

describe('audit regressions', () => {
  const stamp = '2026-01-01T00:00:00.000Z';
  const goodRun = (over: Record<string, unknown> = {}) => ({ id: 'run-1', roomId: 'r1', botId: 'b1', triggerMessageId: 'm1', model: 'gpt-x', status: 'queued',
    steps: 0, error: null, createdAt: stamp, updatedAt: stamp, transcript: [{ role: 'user', content: 'hi' }], ...over });
  const goodApproval = (over: Record<string, unknown> = {}) => ({ id: 'a-1', runId: 'run-1', roomId: 'r1', botId: 'b1', toolCallId: 'c1', tool: 'jira_create_issue',
    access: 'write', args: { a: 1 }, summary: 's', status: 'pending', decidedBy: null, result: null, error: null, createdAt: stamp, updatedAt: stamp, ...over });
  const fileWith = (state: Record<string, unknown>) => {
    const dir = tempDir();
    const file = join(dir, 'state.json');
    writeFileSync(file, JSON.stringify({ version: 1, seq: 0, messages: [], runs: [], approvals: [], settings: null, ...state }));
    return { dir, file };
  };

  test('#3 a pruned message keeps its clientMessageId: same text is a duplicate, other text a conflict', () => {
    const s = new HyperBotsStore(null);
    const original = s.addMessage(msg('r1', 'k-original', 'file the Jira issue')).message;
    for (let i = 0; i < HYPER_BOTS_ROOM_MESSAGES; i++) s.addMessage(msg('r1', `k${i}`, `t${i}`));
    expect(s.getMessage(original.id)).toBeUndefined();
    const again = s.addMessageWithRuns(msg('r1', 'k-original', 'file the Jira issue'), [{ botId: 'b1', model: 'm' }]);
    expect([again.created, again.sameText, again.live, again.message.id, again.added]).toEqual([false, true, false, original.id, []]);
    expect(again.message.text).toBe('file the Jira issue');
    expect(s.listRuns()).toEqual([]);
    expect(s.recall('r1', 'k-original', 'something else')?.sameText).toBe(false);
    expect(s.recall('r2', 'k-original', 'file the Jira issue')).toBeUndefined();
  });

  test('#3 tombstones survive reopen, and older files get tombstones for owner messages on load', () => {
    const { dir, file } = fileWith({ seq: 1, messages: [{ id: 'm1', roomId: 'r1', clientMessageId: 'k1', author: { kind: 'user' }, text: 'old', model: null, runId: null, hop: 0, createdAt: stamp, seq: 1 }] });
    try {
      let s = new HyperBotsStore(file);
      for (let i = 0; i < HYPER_BOTS_ROOM_MESSAGES; i++) s.addMessage(msg('r1', `k-new-${i}`, `t${i}`));
      expect(s.getMessage('m1')).toBeUndefined();
      s = new HyperBotsStore(file);
      const r = s.addMessage(msg('r1', 'k1', 'old'));
      expect([r.created, r.sameText, r.message.id]).toEqual([false, true, 'm1']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('#3 pruning never drops a finished run that owns an open approval, nor a live run\'s reply', () => {
    const s = new HyperBotsStore(null);
    const trigger = s.addMessage(msg('r1', 'k-t', 'go')).message;
    const run = s.createRun(runInput('r1', trigger.id));
    s.updateRun(run.id, { status: 'done' });
    const open = s.createApproval({ ...apprInput(run.id), status: 'approved', decidedBy: 'policy' }).approval;
    const other = s.addMessage(msg('r1', 'k-o', 'other')).message;
    const waiting = s.createRun(runInput('r1', other.id));
    const reply = { roomId: 'r1', clientMessageId: `run:${waiting.id}`, author: { kind: 'bot' as const, botId: 'b1' }, text: 'answer', model: 'gpt-x', runId: waiting.id, hop: 1 };
    const posted = s.addMessage(reply).message;
    for (let i = 0; i < HYPER_BOTS_ROOM_MESSAGES + 5; i++) s.addMessage(msg('r1', `k${i}`, `t${i}`));
    expect(s.getMessage(trigger.id)).toBeDefined();
    expect(s.getRun(run.id)).toBeDefined();
    expect(s.getApproval(open.id)?.status).toBe('approved');
    expect([s.getMessage(other.id)?.id, s.getMessage(posted.id)?.id]).toEqual([other.id, posted.id]);
    // The reply's idempotency key still works while its run is live.
    expect(s.addMessage(reply).created).toBe(false);
  });

  test('#6 a message and its whole run plan are stored in one write; a failed write stores neither', () => {
    const dir = tempDir();
    const file = join(dir, 'state.json');
    try {
      const s = new HyperBotsStore(file);
      const plan = [{ botId: 'scout', model: 'm-a' }, { botId: 'scribe', model: 'm-b' }];
      const seed = (m: { text: string }, botId: string) => [{ role: 'user' as const, content: `${botId}:${m.text}` }];
      const raw = s as unknown as { write(t: string): void };
      const write = raw.write.bind(s);
      let writes = 0;
      raw.write = (t) => { writes++; if (writes === 1) throw new Error('disk full'); write(t); };
      expect(() => s.addMessageWithRuns(msg('r1', 'k1', 'go'), plan, seed)).toThrow('disk full');
      expect([s.listMessages('r1'), s.listRuns()]).toEqual([[], []]);
      const r = s.addMessageWithRuns(msg('r1', 'k1', 'go'), plan, seed);
      expect(writes).toBe(2);
      expect(r.created).toBe(true);
      expect(r.runs.map((x) => [x.botId, x.model, x.transcript[0].content])).toEqual([['scout', 'm-a', 'scout:go'], ['scribe', 'm-b', 'scribe:go']]);
      expect(new HyperBotsStore(file).runsForMessage(r.message.id)).toHaveLength(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('#6 a repeat recreates only the missing planned runs, with the models captured in the plan', () => {
    const { dir, file } = fileWith({
      seq: 1,
      messages: [{ id: 'm1', roomId: 'r1', clientMessageId: 'k1', author: { kind: 'user' }, text: 'go', model: null, runId: null, hop: 0, createdAt: stamp, seq: 1,
        plan: [{ botId: 'scout', model: 'm-a' }, { botId: 'scribe', model: 'm-b' }] }],
      runs: [goodRun({ botId: 'scout', model: 'm-a' })],
    });
    try {
      const s = new HyperBotsStore(file);
      const r = s.addMessageWithRuns(msg('r1', 'k1', 'go'), [{ botId: 'scribe', model: 'IGNORED' }, { botId: 'third', model: 'x' }]);
      expect(r.created).toBe(false);
      expect(r.added.map((x) => [x.botId, x.model])).toEqual([['scribe', 'm-b']]);
      expect(r.runs.map((x) => x.botId)).toEqual(['scout', 'scribe']);
      expect(s.addMessageWithRuns(msg('r1', 'k1', 'go'), null).added).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('#11 every persisted field is validated: damaged runs are quarantined, damaged approvals become unknown', () => {
    const { dir, file } = fileWith({
      runs: [
        goodRun(),
        goodRun({ id: 'no-steps', steps: undefined }),
        goodRun({ id: 'nan-steps', steps: null }),
        goodRun({ id: 'neg-steps', steps: -1 }),
        goodRun({ id: 'frac-steps', steps: 1.5 }),
        goodRun({ id: 'bad-status', status: 'sleeping' }),
        goodRun({ id: 'bad-transcript', transcript: [{ role: 'tool', content: 'x' }] }),
        goodRun({ id: 'bad-time', createdAt: 'yesterday' }),
      ],
      approvals: [
        goodApproval(),
        goodApproval({ id: 'a-2', toolCallId: 'c2', destination: 7 }),
        goodApproval({ id: 'a-3', runId: 'no-steps', toolCallId: 'c3', status: 'approved', decidedBy: 'policy' }),
        goodApproval({ id: 'a-4', toolCallId: 'c4', status: 'approved', decidedBy: 'robot' }),
      ],
    });
    try {
      const s = new HyperBotsStore(file);
      const runs = Object.fromEntries(s.listRuns().map((r) => [r.id, [r.status, r.error]]));
      expect(runs['run-1']).toEqual(['queued', null]);
      for (const id of ['no-steps', 'nan-steps', 'neg-steps', 'frac-steps', 'bad-status', 'bad-transcript', 'bad-time']) expect(runs[id], id).toEqual(['failed', HYPER_BOTS_DAMAGED_RUN]);
      expect(s.listRuns().every((r) => Number.isInteger(r.steps) && r.steps >= 0)).toBe(true);
      // Older approvals without destination/fingerprint load with null.
      expect([s.getApproval('a-1')?.status, s.getApproval('a-1')?.destination, s.getApproval('a-1')?.fingerprint]).toEqual(['pending', null, null]);
      expect([s.getApproval('a-2')?.status, s.getApproval('a-2')?.error]).toEqual(['unknown', HYPER_BOTS_DAMAGED_APPROVAL]);
      expect(s.getApproval('a-3')?.status, 'an open request of a stopped run never runs').toBe('skipped');
      expect(s.getApproval('a-4')?.status).toBe('unknown');
      // The quarantine is written back at once.
      const disk = JSON.parse(readFileSync(file, 'utf8'));
      expect(disk.runs.find((r: { id: string }) => r.id === 'no-steps')).toMatchObject({ status: 'failed', steps: 0 });
      expect(() => s.updateRun('run-1', { steps: Number.NaN })).toThrow();
      expect(() => s.updateRun('run-1', { steps: Infinity })).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('#7 recover closes approved/pending requests whose run is finished: no approved record that never runs', () => {
    const s = new HyperBotsStore(null);
    const run = s.createRun(runInput());
    const a = s.createApproval(apprInput(run.id)).approval;
    s.transitionApproval(a.id, ['pending'], 'approved', { decidedBy: 'owner' });
    s.updateRun(run.id, { status: 'done' });
    expect(s.recover()).toEqual({ runs: 0, approvals: 1 });
    expect([s.getApproval(a.id)?.status, s.getApproval(a.id)?.result]).toEqual(['skipped', HYPER_BOTS_ORPHAN]);
  });

  test('approvals store destination and fingerprint; transitions can rebind them', () => {
    const s = new HyperBotsStore(null);
    const run = s.createRun(runInput());
    const a = s.createApproval({ ...apprInput(run.id), destination: 'Jira OPS', fingerprint: 'fp1' }).approval;
    expect([a.destination, a.fingerprint]).toEqual(['Jira OPS', 'fp1']);
    const b = s.transitionApproval(a.id, ['pending'], 'pending', { destination: 'Jira DEV', fingerprint: 'fp2', decidedBy: null })!;
    expect([b.destination, b.fingerprint, b.decidedBy]).toEqual(['Jira DEV', 'fp2', null]);
    expect(s.transitionApproval(a.id, ['pending'], 'skipped')?.status).toBe('skipped');
  });
});
