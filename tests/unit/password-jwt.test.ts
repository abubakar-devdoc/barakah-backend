import { describe, expect, it } from 'vitest';
import {
  generateTemporaryPassword,
  hashPassword,
  verifyPassword,
  assertPasswordStrength,
} from '../../src/utils/password.js';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  signAccessToken,
  verifyAccessToken,
} from '../../src/utils/jwt.js';

describe('password utils', () => {
  it('hashes and verifies passwords', async () => {
    const hash = await hashPassword('Secret123!');
    expect(hash).not.toEqual('Secret123!');
    expect(await verifyPassword('Secret123!', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('generates temporary passwords of requested length', () => {
    expect(generateTemporaryPassword(16)).toHaveLength(16);
  });

  it('enforces password strength rules', () => {
    expect(assertPasswordStrength('short')).toMatch(/at least 8/i);
    expect(assertPasswordStrength('alllowercase1')).toMatch(/uppercase/i);
    expect(assertPasswordStrength('ALLUPPERCASE1')).toMatch(/lowercase/i);
    expect(assertPasswordStrength('NoDigitsHere')).toMatch(/number/i);
    expect(assertPasswordStrength('ValidPass1')).toBeNull();
  });
});

describe('jwt utils', () => {
  it('signs and verifies access tokens', () => {
    const { token, jti } = signAccessToken({
      userId: '11111111-1111-1111-1111-111111111111',
      platformRole: 'user',
      orgId: '22222222-2222-2222-2222-222222222222',
      orgRole: 'member',
      mustChangePassword: true,
    });
    const claims = verifyAccessToken(token);
    expect(claims.sub).toBe('11111111-1111-1111-1111-111111111111');
    expect(claims.platform_role).toBe('user');
    expect(claims.org_role).toBe('member');
    expect(claims.must_change_password).toBe(true);
    expect(claims.jti).toBe(jti);
  });

  it('rejects invalid tokens', () => {
    expect(() => verifyAccessToken('not-a-token')).toThrow();
  });

  it('hashes opaque refresh tokens stably', () => {
    const token = generateOpaqueToken();
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
    expect(hashOpaqueToken(token)).not.toBe(token);
  });
});
