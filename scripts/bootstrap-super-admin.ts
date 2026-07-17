/**
 * One-time bootstrap helper for local/dev:
 * creates a super_admin user (and optional demo organization).
 *
 * Usage:
 *   BOOTSTRAP_SUPER_ADMIN_EMAIL=admin@example.com \
 *   BOOTSTRAP_SUPER_ADMIN_PASSWORD='StrongPass123!' \
 *   DATABASE_URL='postgresql://postgres:PASSWORD@db.../postgres' \
 *   npx tsx scripts/bootstrap-super-admin.ts
 *
 * Prefer a privileged migration role for this script, then run the API as barakah_app.
 */
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';

loadDotenv();

async function main() {
  const email = (process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD || '';
  const fullName = process.env.BOOTSTRAP_SUPER_ADMIN_NAME || 'Barakah Super Admin';
  const orgName = process.env.BOOTSTRAP_ORG_NAME || 'Barakah Demo Org';
  const orgSlug = process.env.BOOTSTRAP_ORG_SLUG || 'barakah-demo';

  if (!email || !password) {
    throw new Error('Set BOOTSTRAP_SUPER_ADMIN_EMAIL and BOOTSTRAP_SUPER_ADMIN_PASSWORD');
  }
  if (password.length < 8) {
    throw new Error('Bootstrap password must be at least 8 characters');
  }
  const bootstrapUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!bootstrapUrl) {
    throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required');
  }

  const pool = new pg.Pool({
    connectionString: bootstrapUrl,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS || 12));

    const existing = await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email]);
    let userId: string;
    if (existing.rows[0]) {
      userId = existing.rows[0].id;
      await client.query(
        `UPDATE users
         SET password_hash = $2,
             full_name = $3,
             platform_role = 'super_admin',
             status = 'active',
             must_change_password = false,
             deleted_at = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [userId, hash, fullName],
      );
      console.log(`Updated existing super admin: ${email}`);
    } else {
      const created = await client.query(
        `INSERT INTO users (
           email, password_hash, full_name, platform_role, status, must_change_password
         ) VALUES ($1,$2,$3,'super_admin','active', false)
         RETURNING id`,
        [email, hash, fullName],
      );
      userId = created.rows[0].id;
      console.log(`Created super admin: ${email}`);
    }

    const org = await client.query(
      `INSERT INTO organizations (name, slug, org_type, created_by)
       VALUES ($1,$2,'other',$3)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, deleted_at = NULL
       RETURNING id`,
      [orgName, orgSlug, userId],
    );
    const orgId = org.rows[0].id;

    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role, status)
       VALUES ($1,$2,'org_owner','active')
       ON CONFLICT (organization_id, user_id) DO UPDATE
         SET role = 'org_owner', status = 'active', deleted_at = NULL`,
      [orgId, userId],
    );

    await client.query('COMMIT');
    console.log(`Organization ready: ${orgName} (${orgId})`);
    console.log('Bootstrap complete. Rotate this password after first login in production.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
