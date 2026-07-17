/**
 * Seed org members as @barakah.local users with the admin password.
 *
 * Usage:
 *   npx tsx scripts/seed-barakah-users.ts
 */
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';

loadDotenv();

const PASSWORD = process.env.SEED_USER_PASSWORD || 'BarakahAdmin2026!';
const ORG_SLUG = process.env.BOOTSTRAP_ORG_SLUG || 'barakah-demo';

const NAMES = [
  'Mohsin',
  'Tayyaba',
  'Farooq',
  'Sumaira',
  'Yasir',
  'Fatima',
  'Tayyab',
  'Shahzad',
  'Zobi',
  'Shafique',
  'sundas',
  'Usama',
  'Hamza',
  'Iram',
  'Tooba',
  'saad',
  'aiman',
  'shuja',
  'wajiha',
  'Abdullah',
  'ali',
  'ans',
  'hadia',
  'Abubakar',
  'abuzar',
  'amna',
  'maria',
  'majid',
  'abid',
  'reehana',
  'saminakamal',
  'shaguftajabeen',
  'rehanahmed',
  'areeba',
];

function toEmail(name: string): string {
  const local = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return `${local}@barakah.local`;
}

function displayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return name;
  // Keep compound usernames readable: saminakamal -> Saminakamal
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

async function main() {
  const dbUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required');
  if (PASSWORD.length < 8) throw new Error('SEED_USER_PASSWORD must be at least 8 characters');

  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  const client = await pool.connect();

  try {
    const org = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM organizations WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
      [ORG_SLUG],
    );
    if (!org.rows[0]) {
      throw new Error(`Organization with slug "${ORG_SLUG}" not found. Run bootstrap:super-admin first.`);
    }
    const orgId = org.rows[0].id;
    const hash = await bcrypt.hash(PASSWORD, Number(process.env.BCRYPT_ROUNDS || 12));

    console.log(`Seeding ${NAMES.length} users into ${org.rows[0].name} (${orgId})`);
    console.log(`Password for all: ${PASSWORD}`);
    console.log('');

    const created: string[] = [];
    const updated: string[] = [];

    await client.query('BEGIN');

    for (const name of NAMES) {
      const email = toEmail(name);
      const fullName = displayName(name);

      const existing = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE email = $1 LIMIT 1`,
        [email],
      );

      let userId: string;
      if (existing.rows[0]) {
        userId = existing.rows[0].id;
        await client.query(
          `UPDATE users
           SET password_hash = $2,
               full_name = $3,
               platform_role = 'user',
               status = 'active',
               must_change_password = false,
               deleted_at = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [userId, hash, fullName],
        );
        updated.push(email);
      } else {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO users (
             email, password_hash, full_name, platform_role, status, must_change_password
           ) VALUES ($1,$2,$3,'user','active', false)
           RETURNING id`,
          [email, hash, fullName],
        );
        userId = inserted.rows[0]!.id;
        created.push(email);
      }

      await client.query(
        `INSERT INTO organization_members (organization_id, user_id, role, status)
         VALUES ($1,$2,'member','active')
         ON CONFLICT (organization_id, user_id) DO UPDATE
           SET role = CASE
                 WHEN organization_members.role IN ('org_owner', 'org_admin')
                   THEN organization_members.role
                 ELSE 'member'
               END,
               status = 'active',
               deleted_at = NULL,
               updated_at = NOW()`,
        [orgId, userId],
      );
    }

    await client.query('COMMIT');

    console.log(`Created: ${created.length}`);
    for (const email of created) console.log(`  + ${email}`);
    console.log(`Updated: ${updated.length}`);
    for (const email of updated) console.log(`  ~ ${email}`);
    console.log('');
    console.log('Done. All users can sign in with the admin password.');
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
