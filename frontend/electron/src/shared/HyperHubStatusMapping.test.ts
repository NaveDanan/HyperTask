import { describe, expect, it } from 'vitest';
import {
  hyperChooseJiraCandidates, hyperChooseNewsletterCandidates, hyperDetectStatusConflict, hyperMapSourceStatus, hyperStatusEffects,
  type HyperHubJiraTransition, type HyperHubStatusPrecondition,
} from './HyperHubStatusMapping';

const transition = (id: string, destinationId: string, category = 'done'): HyperHubJiraTransition => ({
  id, name: 'Move', to: { id: destinationId, name: 'Duplicate label', category }, fields: {},
});

describe('M5 source status mapping', () => {
  it('uses Jira category keys, leaves undefined completion unknown and preserves a local decision', () => {
    expect(hyperMapSourceStatus('jira', 'new')).toEqual({ category: 'new', completion: 'open', state: 'ready' });
    expect(hyperMapSourceStatus('jira', 'indeterminate')).toMatchObject({ state: 'doing' });
    expect(hyperMapSourceStatus('jira', 'done', 'waiting')).toEqual({ category: 'done', completion: 'complete', state: 'waiting' });
    for (const category of [undefined, 'undefined', 'Closed']) {
      expect(hyperMapSourceStatus('jira', category)).toEqual({ category: 'unknown', completion: 'unknown' });
    }
    expect(hyperMapSourceStatus('newsletter', 'completed')).toMatchObject({ completion: 'complete', state: 'done' });
    expect(hyperMapSourceStatus('newsletter', 'delayed')).toEqual({ category: 'unknown', completion: 'open' });
  });

  it('lists all eligible moves, preselects only a unique intent match and reverses by exact id', () => {
    const moves = [transition('a', '2'), transition('b', '3'), transition('c', '4', 'new'), transition('d', '1')];
    const choose = hyperChooseJiraCandidates('1', moves, { kind: 'choose' });
    expect(choose.candidates.map(candidate => [candidate.candidateId, candidate.preselected])).toEqual([
      ['a', false], ['b', false], ['c', false],
    ]);
    expect(choose.unavailable).toEqual([{ actionLabel: 'Move', toName: 'Duplicate label', reason: 'self' }]);
    expect(hyperChooseJiraCandidates('1', moves, { kind: 'state', state: 'done' }).candidates.every(row => !row.preselected)).toBe(true);
    expect(hyperChooseJiraCandidates('1', moves, { kind: 'state', state: 'ready' }).candidates.filter(row => row.preselected))
      .toMatchObject([{ candidateId: 'c' }]);
    const reverse = hyperChooseJiraCandidates('1', moves, { kind: 'reverse', operationId: 'op' }, '3');
    expect(reverse.candidates).toMatchObject([{ candidateId: 'b', preselected: true }]);
    expect(hyperChooseJiraCandidates('1', [...moves, transition('e', '3')], { kind: 'reverse', operationId: 'op' }, '3')
      .candidates.map(row => row.preselected)).toEqual([false, false]);
  });

  it('allows only the server-listed Resolution exception and discloses global workflow transitions', () => {
    const resolution = { required: true, allowedValues: [{ id: '7', name: 'Fixed' }] };
    const moves: HyperHubJiraTransition[] = [
      { ...transition('a', '2'), isGlobal: true, fields: { resolution } },
      { ...transition('b', '2'), fields: { resolution, customfield_5: { required: true, name: 'Approval' } } },
      { ...transition('c', '2'), fields: { resolution: { required: true, allowedValues: [] } } },
      { ...transition('d', '2'), fields: undefined },
      { ...transition('e', '2'), fields: { resolution: { ...resolution, required: false } } },
    ];
    const { candidates, unavailable } = hyperChooseJiraCandidates('1', moves, { kind: 'choose' });
    expect(candidates).toMatchObject([{ candidateId: 'a', resolution: { values: resolution.allowedValues } }, { candidateId: 'e' }]);
    expect(candidates[1].resolution).toBeUndefined();
    expect(candidates[0].effects).toEqual([{ code: 'workflow-effects' }, { code: 'any-status-transition' }]);
    expect(unavailable).toMatchObject([
      { reason: 'required-fields', fields: ['resolution', 'Approval'] },
      { reason: 'required-fields', fields: ['resolution'] },
      { reason: 'required-fields' },
    ]);
    expect(hyperStatusEffects('jira', '1', '2', { resolutionName: 'Fixed' })).toContainEqual({ code: 'resolution-set', valueName: 'Fixed' });
  });

  it('lists delayed as an explicit option and discloses progress independently of completion and reverse', () => {
    const { candidates } = hyperChooseNewsletterCandidates('in-progress', 100, { kind: 'state', state: 'done' });
    expect(candidates.map(row => row.to.id)).toEqual(['pending', 'completed', 'delayed']);
    expect(candidates.find(row => row.preselected)).toMatchObject({ to: { id: 'completed' }, effects: [
      { code: 'progress-set', from: 100, to: 100 }, { code: 'parent-rollup' }, { code: 'chart-normalized' },
    ] });
    expect(hyperMapSourceStatus('newsletter', 'in-progress').completion).toBe('open');
    expect(hyperChooseNewsletterCandidates('completed', 100, { kind: 'reverse', operationId: 'op' }, 'delayed').candidates)
      .toMatchObject([{ to: { id: 'delayed' }, preselected: true, effects: [
        { code: 'progress-kept', value: 100 }, { code: 'parent-rollup' }, { code: 'chart-normalized' },
      ] }]);
    expect(hyperStatusEffects('newsletter', 'pending', 'completed')).toContainEqual({ code: 'progress-set', from: null, to: 100 });
  });

  it('detects revision, destination, required Resolution and changed Newsletter observations', () => {
    const candidate = hyperChooseJiraCandidates('1', [{
      ...transition('t', '2'), fields: { resolution: { required: true, allowedValues: [{ id: '7', name: 'Fixed' }] } },
    }], { kind: 'choose' }).candidates[0];
    const jira: HyperHubStatusPrecondition = { source: 'jira', statusId: '1', revision: 'now', candidate };
    expect(hyperDetectStatusConflict(jira, { ...jira, candidate: { ...candidate, actionLabel: 'Renamed' } }, '7')).toBe(false);
    expect(hyperDetectStatusConflict(jira, { ...jira, statusId: '3' }, '7')).toBe(true);
    expect(hyperDetectStatusConflict(jira, { ...jira, revision: 'later' }, '7')).toBe(true);
    expect(hyperDetectStatusConflict(jira, { ...jira, candidate: undefined }, '7')).toBe(true);
    expect(hyperDetectStatusConflict(jira, { ...jira, candidate: { ...candidate, to: { ...candidate.to, id: '4' } } }, '7')).toBe(true);
    expect(hyperDetectStatusConflict(jira, jira, 'forged')).toBe(true);
    const newsletter: HyperHubStatusPrecondition = { source: 'newsletter', statusId: 'pending', revision: 'now', leaf: true, progress: 0 };
    expect(hyperDetectStatusConflict(newsletter, newsletter)).toBe(false);
    expect(hyperDetectStatusConflict(newsletter, { ...newsletter, progress: 5 })).toBe(true);
    expect(hyperDetectStatusConflict(newsletter, { ...newsletter, leaf: false })).toBe(true);
  });
});
