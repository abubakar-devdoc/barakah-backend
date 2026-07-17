import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import type { AuthContext } from '../models/types.js';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  ssl: env.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export interface DbClient {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ) => Promise<QueryResult<T>>;
  /** Update request-scoped RLS identity mid-transaction (e.g. after login lookup). */
  setIdentity: (identity: RequestIdentity) => Promise<void>;
}

export interface RequestIdentity {
  userId?: string | null;
  orgId?: string | null;
  platformRole?: string | null;
  orgRole?: string | null;
}

async function setLocalIdentity(client: PoolClient, identity: RequestIdentity): Promise<void> {
  await client.query(`SELECT set_config('app.user_id', $1, true)`, [identity.userId ?? '']);
  await client.query(`SELECT set_config('app.org_id', $1, true)`, [identity.orgId ?? '']);
  await client.query(`SELECT set_config('app.platform_role', $1, true)`, [
    identity.platformRole ?? '',
  ]);
  await client.query(`SELECT set_config('app.org_role', $1, true)`, [identity.orgRole ?? '']);
}

/**
 * Runs work inside a transaction with request-scoped RLS identity.
 * Uses SET LOCAL / set_config(..., true) so values never leak across pooled connections.
 */
export async function withTransaction<T>(
  identity: RequestIdentity,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setLocalIdentity(client, identity);
    const result = await fn({
      query: <R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) =>
        client.query<R>(text, params),
      setIdentity: (next) => setLocalIdentity(client, next),
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr }, 'Rollback failed');
    }
    throw err;
  } finally {
    client.release();
  }
}

export function identityFromAuth(auth?: AuthContext | null): RequestIdentity {
  if (!auth) return {};
  return {
    userId: auth.userId,
    orgId: auth.orgId ?? null,
    platformRole: auth.platformRole,
    orgRole: auth.orgRole ?? null,
  };
}

export async function checkDbReady(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
