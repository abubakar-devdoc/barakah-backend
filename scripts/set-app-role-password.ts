import { config as loadDotenv } from 'dotenv';
import pg from 'pg';

loadDotenv();

async function main(): Promise<void> {
  const password = process.env.BARAKAH_APP_DB_PASSWORD;
  const ownerUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!ownerUrl || !password) {
    throw new Error(
      'MIGRATION_DATABASE_URL or DATABASE_URL, plus BARAKAH_APP_DB_PASSWORD, are required',
    );
  }
  if (!/^[A-Za-z0-9_-]{32,}$/.test(password)) {
    throw new Error('BARAKAH_APP_DB_PASSWORD must be at least 32 safe characters');
  }

  const client = new pg.Client({
    connectionString: ownerUrl,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    await client.query(`ALTER ROLE barakah_app PASSWORD '${password}'`);
    console.log('barakah_app password set');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
