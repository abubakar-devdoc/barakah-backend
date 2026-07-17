import type { DbClient } from '../db/pool.js';
import type { AuthSessionRow, OrgRole, UserRow } from '../models/types.js';

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    fullName: user.full_name,
    avatarUrl: user.avatar_url,
    city: user.city,
    country: user.country,
    platformRole: user.platform_role,
    status: user.status,
    mustChangePassword: user.must_change_password,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

export class UserRepository {
  constructor(private readonly db: DbClient) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [email.toLowerCase()],
    );
    return rows[0] ?? null;
  }

  /** Pre-auth lookup that bypasses RLS via SECURITY DEFINER helper. */
  async findByEmailForAuth(email: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT * FROM auth_find_user_by_email($1)`,
      [email.toLowerCase()],
    );
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** Pre-auth lookup that bypasses RLS via SECURITY DEFINER helper. */
  async findByIdForAuth(id: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT * FROM auth_find_user_by_id($1)`,
      [id],
    );
    return rows[0] ?? null;
  }

  async list(limit: number, offset: number): Promise<{ rows: UserRow[]; total: number }> {
    const count = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users WHERE deleted_at IS NULL`,
    );
    const { rows } = await this.db.query<UserRow>(
      `SELECT * FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return { rows, total: Number(count.rows[0]?.count ?? 0) };
  }

  async create(input: {
    email: string;
    passwordHash: string;
    fullName: string;
    phone?: string | null;
    city?: string | null;
    country?: string | null;
    platformRole: string;
    status: string;
    mustChangePassword: boolean;
    createdBy?: string | null;
  }): Promise<UserRow> {
    const { rows } = await this.db.query<UserRow>(
      `INSERT INTO users (
         email, password_hash, full_name, phone, city, country,
         platform_role, status, must_change_password, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        input.email.toLowerCase(),
        input.passwordHash,
        input.fullName,
        input.phone ?? null,
        input.city ?? null,
        input.country ?? null,
        input.platformRole,
        input.status,
        input.mustChangePassword,
        input.createdBy ?? null,
      ],
    );
    return rows[0]!;
  }

  async update(
    id: string,
    patch: Partial<{
      full_name: string;
      phone: string | null;
      city: string | null;
      country: string | null;
      status: string;
      platform_role: string;
      password_hash: string;
      must_change_password: boolean;
      failed_login_attempts: number;
      locked_until: Date | null;
      last_login_at: Date | null;
    }>,
  ): Promise<UserRow | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        fields.push(`${key} = $${i}`);
        values.push(value);
        i += 1;
      }
    }
    if (!fields.length) return this.findById(id);
    values.push(id);
    const { rows } = await this.db.query<UserRow>(
      `UPDATE users SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${i} AND deleted_at IS NULL
       RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE users SET deleted_at = NOW(), status = 'disabled', updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  async getMembership(
    userId: string,
    orgId: string,
  ): Promise<{ role: OrgRole; status: string } | null> {
    const { rows } = await this.db.query<{ role: OrgRole; status: string }>(
      `SELECT role, status FROM organization_members
       WHERE user_id = $1 AND organization_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [userId, orgId],
    );
    return rows[0] ?? null;
  }

  async getPrimaryMembership(
    userId: string,
  ): Promise<{ organizationId: string; role: OrgRole; status: string } | null> {
    const { rows } = await this.db.query<{
      organization_id: string;
      role: OrgRole;
      status: string;
    }>(
      `SELECT organization_id, role, status FROM organization_members
       WHERE user_id = $1 AND status = 'active' AND deleted_at IS NULL
       ORDER BY
         CASE role
           WHEN 'org_owner' THEN 0
           WHEN 'org_admin' THEN 1
           ELSE 2
         END,
         created_at ASC
       LIMIT 1`,
      [userId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      organizationId: row.organization_id,
      role: row.role,
      status: row.status,
    };
  }
}

export class AuthSessionRepository {
  constructor(private readonly db: DbClient) {}

  async create(input: {
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    rememberMe: boolean;
    userAgent?: string | null;
    ip?: string | null;
  }): Promise<AuthSessionRow> {
    const { rows } = await this.db.query<AuthSessionRow>(
      `INSERT INTO auth_sessions (
         user_id, family_id, token_hash, expires_at, remember_me, user_agent, ip
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        input.userId,
        input.familyId,
        input.tokenHash,
        input.expiresAt,
        input.rememberMe,
        input.userAgent ?? null,
        input.ip ?? null,
      ],
    );
    return rows[0]!;
  }

  async findByTokenHash(tokenHash: string): Promise<AuthSessionRow | null> {
    const { rows } = await this.db.query<AuthSessionRow>(
      `SELECT * FROM auth_find_session_by_token_hash($1)`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  async findActiveByFamily(familyId: string): Promise<AuthSessionRow | null> {
    const { rows } = await this.db.query<AuthSessionRow>(
      `SELECT * FROM auth_sessions
       WHERE family_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [familyId],
    );
    return rows[0] ?? null;
  }

  async revoke(id: string, replacedBy?: string | null): Promise<void> {
    await this.db.query(
      `UPDATE auth_sessions
       SET revoked_at = NOW(), replaced_by = COALESCE($2, replaced_by), updated_at = NOW()
       WHERE id = $1 AND revoked_at IS NULL`,
      [id, replacedBy ?? null],
    );
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db.query(
      `UPDATE auth_sessions SET revoked_at = NOW(), updated_at = NOW()
       WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE auth_sessions SET revoked_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }

  async deleteExpired(before: Date): Promise<number> {
    const { rowCount } = await this.db.query(
      `DELETE FROM auth_sessions WHERE expires_at < $1 OR (revoked_at IS NOT NULL AND revoked_at < $1 - INTERVAL '7 days')`,
      [before],
    );
    return rowCount ?? 0;
  }
}
