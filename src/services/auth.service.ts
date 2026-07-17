import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { env } from '../config/env.js';
import { identityFromAuth, withTransaction } from '../db/pool.js';
import type { AuthContext } from '../models/types.js';
import { AuthSessionRepository, UserRepository, publicUser } from '../repositories/user.repository.js';
import { AuditRepository } from '../repositories/campaign.repository.js';
import {
  assertPasswordStrength,
  generateTemporaryPassword,
  hashPassword,
  verifyPassword,
} from '../utils/password.js';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  refreshExpiryDate,
  signAccessToken,
} from '../utils/jwt.js';
import { badRequest, conflict, forbidden, unauthorized } from '../utils/errors.js';

function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(env.REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.refreshCookieSecure,
    sameSite: env.REFRESH_COOKIE_SAME_SITE,
    path: env.REFRESH_COOKIE_PATH,
    expires: expiresAt,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(env.REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.refreshCookieSecure,
    sameSite: env.REFRESH_COOKIE_SAME_SITE,
    path: env.REFRESH_COOKIE_PATH,
  });
}

export class AuthService {
  async login(input: {
    email: string;
    password: string;
    rememberMe?: boolean;
    orgId?: string;
    userAgent?: string;
    ip?: string;
    res: Response;
  }) {
    return withTransaction({}, async (db) => {
      const users = new UserRepository(db);
      const sessions = new AuthSessionRepository(db);
      const audit = new AuditRepository(db);

      const user = await users.findByEmailForAuth(input.email);
      if (!user || user.status === 'disabled') {
        throw unauthorized('Invalid email or password');
      }
      if (user.locked_until && user.locked_until > new Date()) {
        throw forbidden('Account temporarily locked');
      }

      const ok = await verifyPassword(input.password, user.password_hash);
      if (!ok) {
        await db.setIdentity({
          userId: user.id,
          platformRole: user.platform_role,
        });
        const attempts = user.failed_login_attempts + 1;
        const lockedUntil = attempts >= 8 ? new Date(Date.now() + 15 * 60 * 1000) : null;
        await users.update(user.id, {
          failed_login_attempts: attempts,
          locked_until: lockedUntil,
        });
        throw unauthorized('Invalid email or password');
      }

      await db.setIdentity({
        userId: user.id,
        platformRole: user.platform_role,
        orgId: input.orgId ?? null,
      });

      let orgRole = undefined as AuthContext['orgRole'];
      let orgId = input.orgId;
      if (!orgId) {
        const primary = await users.getPrimaryMembership(user.id);
        if (primary) {
          orgId = primary.organizationId;
          orgRole = primary.role;
        }
      }
      if (orgId) {
        const membership = await users.getMembership(user.id, orgId);
        if (!membership || membership.status !== 'active') {
          if (user.platform_role !== 'super_admin') {
            throw forbidden('Not a member of the selected organization');
          }
        } else {
          orgRole = membership.role;
          await db.setIdentity({
            userId: user.id,
            platformRole: user.platform_role,
            orgId,
            orgRole,
          });
        }
      }

      await users.update(user.id, {
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: new Date(),
      });

      const familyId = randomUUID();
      const refreshToken = generateOpaqueToken();
      const expiresAt = refreshExpiryDate(Boolean(input.rememberMe));
      await sessions.create({
        userId: user.id,
        familyId,
        tokenHash: hashOpaqueToken(refreshToken),
        expiresAt,
        rememberMe: Boolean(input.rememberMe),
        userAgent: input.userAgent,
        ip: input.ip,
      });

      const access = signAccessToken({
        userId: user.id,
        platformRole: user.platform_role,
        orgId,
        orgRole,
        mustChangePassword: user.must_change_password,
      });

      setRefreshCookie(input.res, refreshToken, expiresAt);
      await audit.write({
        actorUserId: user.id,
        organizationId: orgId,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        ip: input.ip,
        userAgent: input.userAgent,
      });

      return {
        accessToken: access.token,
        expiresIn: access.expiresIn,
        user: publicUser(user),
        orgId: orgId ?? null,
        orgRole: orgRole ?? null,
      };
    });
  }

  async refresh(input: {
    refreshToken?: string;
    userAgent?: string;
    ip?: string;
    res: Response;
  }) {
    if (!input.refreshToken) throw unauthorized('Missing refresh token');

    return withTransaction({}, async (db) => {
      const users = new UserRepository(db);
      const sessions = new AuthSessionRepository(db);

      const hash = hashOpaqueToken(input.refreshToken!);
      let session = await sessions.findByTokenHash(hash);
      if (!session) throw unauthorized('Invalid refresh token');

      await db.setIdentity({ userId: session.user_id });

      if (session.revoked_at) {
        // Grace for concurrent refresh (React StrictMode / double tab): follow the
        // active tip of the family instead of wiping the whole session chain.
        const revokedAt = session.revoked_at.getTime();
        const withinGrace = Date.now() - revokedAt < 60_000;
        const active = withinGrace
          ? await sessions.findActiveByFamily(session.family_id)
          : null;
        if (!active) {
          await sessions.revokeFamily(session.family_id);
          throw unauthorized('Refresh token reuse detected');
        }
        session = active;
      }
      if (session.expires_at < new Date()) {
        await sessions.revoke(session.id);
        throw unauthorized('Refresh token expired');
      }

      const user = await users.findByIdForAuth(session.user_id);
      if (!user || user.status === 'disabled') {
        await sessions.revokeFamily(session.family_id);
        throw unauthorized('User unavailable');
      }

      await db.setIdentity({
        userId: user.id,
        platformRole: user.platform_role,
      });

      const primary = await users.getPrimaryMembership(user.id);
      const orgId = primary?.organizationId;
      const orgRole = primary?.role;
      if (orgId && orgRole) {
        await db.setIdentity({
          userId: user.id,
          platformRole: user.platform_role,
          orgId,
          orgRole,
        });
      }

      const newRefresh = generateOpaqueToken();
      const expiresAt = refreshExpiryDate(session.remember_me);
      const newSession = await sessions.create({
        userId: user.id,
        familyId: session.family_id,
        tokenHash: hashOpaqueToken(newRefresh),
        expiresAt,
        rememberMe: session.remember_me,
        userAgent: input.userAgent,
        ip: input.ip,
      });
      await sessions.revoke(session.id, newSession.id);

      const access = signAccessToken({
        userId: user.id,
        platformRole: user.platform_role,
        orgId,
        orgRole,
        mustChangePassword: user.must_change_password,
      });

      setRefreshCookie(input.res, newRefresh, expiresAt);
      return {
        accessToken: access.token,
        expiresIn: access.expiresIn,
        user: publicUser(user),
        orgId: orgId ?? null,
        orgRole: orgRole ?? null,
      };
    });
  }

  async logout(input: { refreshToken?: string; res: Response; auth?: AuthContext }) {
    await withTransaction(identityFromAuth(input.auth), async (db) => {
      const sessions = new AuthSessionRepository(db);
      if (input.refreshToken) {
        const session = await sessions.findByTokenHash(hashOpaqueToken(input.refreshToken));
        if (session) {
          await db.setIdentity({ userId: session.user_id });
          await sessions.revokeFamily(session.family_id);
        }
      } else if (input.auth) {
        await sessions.revokeAllForUser(input.auth.userId);
      }
    });
    clearRefreshCookie(input.res);
  }

  async changePassword(input: {
    auth: AuthContext;
    currentPassword: string;
    newPassword: string;
    res: Response;
  }) {
    const strength = assertPasswordStrength(input.newPassword);
    if (strength) throw badRequest(strength);

    return withTransaction(identityFromAuth(input.auth), async (db) => {
      const users = new UserRepository(db);
      const sessions = new AuthSessionRepository(db);
      const audit = new AuditRepository(db);

      const user = await users.findById(input.auth.userId);
      if (!user) throw unauthorized();

      const ok = await verifyPassword(input.currentPassword, user.password_hash);
      if (!ok) throw unauthorized('Current password is incorrect');

      const passwordHash = await hashPassword(input.newPassword);
      const updated = await users.update(user.id, {
        password_hash: passwordHash,
        must_change_password: false,
      });
      await sessions.revokeAllForUser(user.id);
      clearRefreshCookie(input.res);

      await audit.write({
        actorUserId: user.id,
        action: 'auth.change_password',
        entityType: 'user',
        entityId: user.id,
      });

      return { user: publicUser(updated!) };
    });
  }

  async me(auth: AuthContext) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const users = new UserRepository(db);
      const user = await users.findById(auth.userId);
      if (!user) throw unauthorized();
      return {
        user: publicUser(user),
        orgId: auth.orgId ?? null,
        orgRole: auth.orgRole ?? null,
      };
    });
  }
}

export class UserAdminService {
  async create(input: {
    auth: AuthContext;
    email: string;
    fullName: string;
    phone?: string;
    city?: string;
    country?: string;
    platformRole?: 'super_admin' | 'user';
    organizationId?: string;
    orgRole?: 'org_owner' | 'org_admin' | 'member';
    temporaryPassword?: string;
  }) {
    if (input.platformRole === 'super_admin' && input.auth.platformRole !== 'super_admin') {
      throw forbidden('Only super admins can create super admins');
    }
    if (input.auth.platformRole !== 'super_admin' && input.auth.orgRole !== 'org_owner' && input.auth.orgRole !== 'org_admin') {
      throw forbidden('Admin privileges required to create users');
    }

    const tempPassword = input.temporaryPassword ?? generateTemporaryPassword();
    const strength = assertPasswordStrength(tempPassword);
    if (strength) throw badRequest(strength);

    return withTransaction(identityFromAuth(input.auth), async (db) => {
      const users = new UserRepository(db);
      const audit = new AuditRepository(db);
      const existing = await users.findByEmail(input.email);
      if (existing) throw conflict('Email already registered');

      if (!input.organizationId && input.auth.orgId) {
        input = { ...input, organizationId: input.auth.orgId };
      }
      if (!input.organizationId && input.platformRole !== 'super_admin') {
        throw badRequest('organizationId is required when creating org members');
      }

      const passwordHash = await hashPassword(tempPassword);
      const user = await users.create({
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        phone: input.phone,
        city: input.city,
        country: input.country,
        platformRole: input.platformRole ?? 'user',
        status: 'invited',
        mustChangePassword: true,
        createdBy: input.auth.userId,
      });

      if (input.organizationId) {
        await db.query(
          `INSERT INTO organization_members (organization_id, user_id, role, status, invited_by)
           VALUES ($1,$2,$3,'active',$4)
           ON CONFLICT (organization_id, user_id) DO UPDATE
             SET role = EXCLUDED.role, status = 'active', deleted_at = NULL, updated_at = NOW()`,
          [input.organizationId, user.id, input.orgRole ?? 'member', input.auth.userId],
        );
      }

      await audit.write({
        actorUserId: input.auth.userId,
        organizationId: input.organizationId,
        action: 'user.create',
        entityType: 'user',
        entityId: user.id,
        after: { email: user.email, platformRole: user.platform_role },
      });

      return {
        user: publicUser(user),
        temporaryPassword: tempPassword,
      };
    });
  }

  async list(auth: AuthContext, page: number, limit: number) {
    if (auth.platformRole !== 'super_admin' && auth.orgRole !== 'org_admin' && auth.orgRole !== 'org_owner') {
      throw forbidden();
    }
    return withTransaction(identityFromAuth(auth), async (db) => {
      const users = new UserRepository(db);
      const offset = (page - 1) * limit;
      const result = await users.list(limit, offset);
      return {
        items: result.rows.map(publicUser),
        page,
        limit,
        total: result.total,
      };
    });
  }

  async get(auth: AuthContext, userId: string) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const users = new UserRepository(db);
      const user = await users.findById(userId);
      if (!user) throw badRequest('User not found');
      return { user: publicUser(user) };
    });
  }

  async update(
    auth: AuthContext,
    userId: string,
    patch: {
      fullName?: string;
      phone?: string | null;
      city?: string | null;
      country?: string | null;
      status?: 'active' | 'invited' | 'disabled';
      platformRole?: 'super_admin' | 'user';
    },
  ) {
    if (auth.platformRole !== 'super_admin' && auth.orgRole !== 'org_admin' && auth.orgRole !== 'org_owner') {
      throw forbidden();
    }
    if (patch.platformRole === 'super_admin' && auth.platformRole !== 'super_admin') {
      throw forbidden('Only super admins can promote super admins');
    }

    return withTransaction(identityFromAuth(auth), async (db) => {
      const users = new UserRepository(db);
      const sessions = new AuthSessionRepository(db);
      const updated = await users.update(userId, {
        full_name: patch.fullName,
        phone: patch.phone,
        city: patch.city,
        country: patch.country,
        status: patch.status,
        platform_role: patch.platformRole,
      });
      if (!updated) throw badRequest('User not found');
      if (patch.status === 'disabled') {
        await sessions.revokeAllForUser(userId);
      }
      return { user: publicUser(updated) };
    });
  }

  async remove(auth: AuthContext, userId: string) {
    if (auth.platformRole !== 'super_admin') throw forbidden();
    return withTransaction(identityFromAuth(auth), async (db) => {
      const users = new UserRepository(db);
      const sessions = new AuthSessionRepository(db);
      const ok = await users.softDelete(userId);
      if (!ok) throw badRequest('User not found');
      await sessions.revokeAllForUser(userId);
      return { deleted: true };
    });
  }
}

export const authService = new AuthService();
export const userAdminService = new UserAdminService();
