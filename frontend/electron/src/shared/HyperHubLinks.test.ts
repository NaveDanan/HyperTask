import { expect, it } from 'vitest';
import { hyperHubMentions } from './HyperHubLinks';
const issue = { evidenceId: 'A', key: 'ENG-9', instance: 'https://jira.example/team', url: 'https://jira.example/team/browse/ENG-9' };
it('resolves bare keys in a single instance and canonical URLs across instances', () => {
  const other = { ...issue, evidenceId: 'B', instance: 'https://other.example', url: 'https://other.example/browse/ENG-9' };
  expect(hyperHubMentions('Send logs for ENG-9.', [issue])).toEqual(['A']);
  expect(hyperHubMentions('Send logs for ENG-9.', [issue, other])).toEqual([]);
  expect(hyperHubMentions('See ' + issue.url + '?view=all.', [issue, other])).toEqual(['A']);
});
it.each(['https://external.example/ENG-9', 'https://jira.example/other/browse/ENG-9',
  'https://jira.example.evil.test/team/browse/ENG-9', 'https://user@jira.example/team/browse/ENG-9'])('rejects %s', url => {
  expect(hyperHubMentions(url, [issue])).toEqual([]);
});
