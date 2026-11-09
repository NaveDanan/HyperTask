import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { GotrueTokenResponsePBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { loginCallbackUrl } from './deep-link';

describe('loginCallbackUrl', () => {
  it('orders and encodes the token fields like passGotrueTokenResponse', () => {
    const token = create(GotrueTokenResponsePBSchema, {
      accessToken: 'a b',
      tokenType: 'bearer',
      expiresIn: 3600n,
      expiresAt: 1700000000n,
      refreshToken: 'r',
    });
    expect(loginCallbackUrl(token)).toBe(
      'appflowy-flutter://login-callback#access_token=a%20b&expires_at=1700000000&expires_in=3600&refresh_token=r&token_type=bearer',
    );
  });

  it('returns null when no field is present', () => {
    expect(loginCallbackUrl(create(GotrueTokenResponsePBSchema, {}))).toBeNull();
  });
});
