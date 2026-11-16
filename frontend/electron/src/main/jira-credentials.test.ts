import { describe, expect, it } from 'vitest';
import { uuidV5 } from './jira-credentials';

describe('uuidV5', () => {
  it('matches the published RFC 4122 v5 vectors (uuid package README)', () => {
    expect(uuidV5('https://www.w3.org/')).toBe('c106a26a-21bb-5538-8bf2-57095d1976c1');
    expect(uuidV5('hello.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('fdda765f-fc57-5604-a269-52a7df8164ec');
  });

  it('is stable for an account id', () => {
    expect(uuidV5('https://jira.example.com|DEMO')).toBe(uuidV5('https://jira.example.com|DEMO'));
    expect(uuidV5('a')).not.toBe(uuidV5('b'));
  });
});
