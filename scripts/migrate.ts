import { config as loadDotenv } from 'dotenv';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

loadDotenv();

const migrationsDir = path.resolve('supabase/migrations');

async function main(): Promise<void> {
  const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!migrationUrl) {
    throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required');
  }

  const pool = new pg.Pool({
    connectionString: migrationUrl,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [728_145_001]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.barakah_schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const filename of files) {
      const alreadyApplied = await client.query(
        'SELECT 1 FROM public.barakah_schema_migrations WHERE filename = $1',
        [filename],
      );
      if (alreadyApplied.rowCount) {
        console.log(`skip  ${filename}`);
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
      console.log(`apply ${filename}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO public.barakah_schema_migrations (filename) VALUES ($1)',
          [filename],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    console.log('All migrations applied.');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [728_145_001]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
