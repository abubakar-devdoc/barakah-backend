import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { AccessTokenClaims, OrgRole, PlatformRole } from '../models/types.js';
import { unauthorized } from './errors.js';

export function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateOpaqueToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function signAccessToken(input: {
  userId: string;
  platformRole: PlatformRole;
  orgId?: string;
  orgRole?: OrgRole;
  mustChangePassword?: boolean;
}): { token: string; jti: string; expiresIn: string } {
  const jti = crypto.randomUUID();
  const claims: AccessTokenClaims = {
    sub: input.userId,
    platform_role: input.platformRole,
    jti,
    must_change_password: input.mustChangePassword ?? false,
  };
  if (input.orgId) claims.org_id = input.orgId;
  if (input.orgRole) claims.org_role = input.orgRole;

  const token = jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });

  return { token, jti, expiresIn: env.JWT_ACCESS_EXPIRES_IN };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }) as AccessTokenClaims;

    if (!payload.sub || !payload.platform_role || !payload.jti) {
      throw unauthorized('Invalid access token');
    }
    return payload;
  } catch (err) {
    if (err instanceof Error && 'statusCode' in err) throw err;
    throw unauthorized('Invalid or expired access token');
  }
}

export function refreshExpiryDate(rememberMe = false): Date {
  const days = rememberMe ? env.REFRESH_TOKEN_EXPIRES_DAYS * 2 : env.REFRESH_TOKEN_EXPIRES_DAYS;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
