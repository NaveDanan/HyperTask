import { describe, expect, it, vi } from 'vitest';
import { AFRolePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import {
  authTokenOf,
  buildInviteLink,
  formatJoinedDate,
  generateInviteCode,
  getInviteCode,
  inviteCodeUrl,
  isEmail,
  memberRequest,
  roleCan,
  roleDescriptionKey,
} from './members-core';
import { addSchemaIfNeeded, buildNamespaceUrl, buildPublishUrl, namespaceErrorKey, publishNameErrorKey } from './sites-core';

describe('members (widgets/members/**)', () => {
  it('only owners can invite, delete and update; non-owners can leave', () => {
    expect(roleCan.invite(AFRolePB.Owner)).toBe(true);
    expect(roleCan.invite(AFRolePB.Member)).toBe(false);
    expect(roleCan.delete(AFRolePB.Guest)).toBe(false);
    expect(roleCan.update(AFRolePB.Owner)).toBe(true);
    expect(roleCan.leave(AFRolePB.Owner)).toBe(false);
    expect(roleCan.leave(AFRolePB.Guest)).toBe(true);
    expect(roleDescriptionKey(AFRolePB.Member)).toBe('settings.appearance.members.member');
  });

  it('reads the access token from the profile token JSON', () => {
    expect(authTokenOf({ token: JSON.stringify({ access_token: 'abc' }) })).toBe('abc');
    expect(authTokenOf({ token: '' })).toBeNull();
    expect(authTokenOf({ token: JSON.stringify({ access_token: 3 }) })).toBeNull();
    expect(authTokenOf({ token: '{}' })).toBeNull();
  });

  it('keeps only the scheme, host and port of the base URL', () => {
    expect(inviteCodeUrl('https://flowy.internal/some/path', 'w1')).toBe('https://flowy.internal/api/workspace/w1/invite-code');
    expect(inviteCodeUrl('http://collaboration.example.com:8080', 'w1')).toBe('http://collaboration.example.com:8080/api/workspace/w1/invite-code');
    expect(inviteCodeUrl('https://flowy.internal:443', 'w1')).toBe('https://flowy.internal/api/workspace/w1/invite-code');
  });

  it('builds the invite link only with an auth token', () => {
    expect(buildInviteLink('https://web.internal', 'CODE', 'tok')).toBe('https://web.internal/app/invited/CODE');
    expect(buildInviteLink('', 'CODE', 'tok')).toBe('/app/invited/CODE');
    expect(buildInviteLink('https://web.internal', 'CODE', null)).toBe('');
  });

  it('validates emails like string_validator', () => {
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('First.Last+tag@Example.ORG')).toBe(true);
    expect(isEmail('nope')).toBe(false);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('')).toBe(false);
    expect(isEmail('a b@c.com')).toBe(false);
  });

  it('formats the joined date as "Joined on MMM d, y"', () => {
    const local = new Date(2024, 2, 5, 12).getTime() / 1000;
    expect(formatJoinedDate(local, 'en-US')).toBe('Joined on Mar 5, 2024');
  });

  it('maps HTTP results like MemberHttpService', async () => {
    const ok = vi.fn().mockResolvedValue({ status: 200, body: JSON.stringify({ data: { code: 'XYZ' } }) });
    expect(await getInviteCode(ok, 'https://s.internal', 't', 'w')).toEqual({ ok: true, value: 'XYZ' });
    expect(ok.mock.calls[0][0]).toMatchObject({
      url: 'https://s.internal/api/workspace/w/invite-code',
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    });

    const empty = vi.fn().mockResolvedValue({ status: 200, body: JSON.stringify({ data: { code: '' } }) });
    expect(await getInviteCode(empty, 'https://s.internal', 't', 'w')).toEqual({ ok: false, msg: 'Failed to get invite code: ' });

    const denied = vi.fn().mockResolvedValue({ status: 403, body: JSON.stringify({ msg: 'Forbidden' }) });
    expect(await memberRequest(denied, { baseUrl: 'https://s.internal', authToken: 't', workspaceId: 'w', method: 'GET', errorMessage: 'x' })).toEqual({
      ok: false,
      msg: 'Forbidden',
    });

    const noBody = vi.fn().mockResolvedValue({ status: 500, body: '' });
    expect(await memberRequest(noBody, { baseUrl: 'https://s.internal', authToken: 't', workspaceId: 'w', method: 'GET', errorMessage: 'fallback' })).toEqual({
      ok: false,
      msg: 'fallback',
    });

    const thrown = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await getInviteCode(thrown, 'https://s.internal', 't', 'w')).toEqual({ ok: false, msg: 'Network error: offline' });

    const post = vi.fn().mockResolvedValue({ status: 200, body: JSON.stringify({ data: { code: 42 } }) });
    expect(await generateInviteCode(post, 'https://s.internal', 't', 'w')).toEqual({ ok: true, value: '42' });
    expect(post.mock.calls[0][0]).toMatchObject({ method: 'POST', body: '{"validity_period_hours":null}' });
  });
});

describe('sites (pages/sites/**)', () => {
  it('adds https:// only when there is no scheme', () => {
    expect(addSchemaIfNeeded('web.internal/a/b')).toBe('https://web.internal/a/b');
    expect(addSchemaIfNeeded('http://web.internal/a/b')).toBe('http://web.internal/a/b');
  });

  it('builds publish and namespace URLs like ShareConstants', () => {
    expect(buildPublishUrl('https://web.internal', 'ns', 'page')).toBe('https://web.internal/ns/page');
    expect(buildNamespaceUrl('https://web.internal', 'ns')).toBe('web.internal/ns');
    expect(buildNamespaceUrl('https://web.internal', 'ns', true)).toBe('https://web.internal/ns');
    expect(buildNamespaceUrl('http://web.internal', 'ns')).toBe('http://web.internal/ns');
  });

  it('maps namespace and publish-name error codes', () => {
    expect(namespaceErrorKey(ErrorCode.CustomNamespaceAlreadyTaken)).toBe('settings.sites.error.namespaceAlreadyInUse');
    expect(namespaceErrorKey(ErrorCode.InvalidRequest)).toBe('settings.sites.error.invalidNamespace');
    expect(namespaceErrorKey(ErrorCode.Internal)).toBeNull();
    expect(publishNameErrorKey(ErrorCode.ViewNameInvalid)).toBe('settings.sites.error.publishNameCannotBeEmpty');
    expect(publishNameErrorKey(ErrorCode.Internal)).toBeNull();
  });
});
