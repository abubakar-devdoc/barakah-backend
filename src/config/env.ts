import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1).default('postgresql://barakah_app:CHANGE_ME@127.0.0.1:5432/barakah'),
  DATABASE_SSL: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  JWT_ACCESS_SECRET: z.string().min(32).default('dev-only-access-secret-change-me-32'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_ISSUER: z.string().default('barakah-api'),
  JWT_AUDIENCE: z.string().default('barakah-clients'),
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().int().positive().default(30),
  REFRESH_COOKIE_NAME: z.string().default('barakah_refresh'),
  REFRESH_COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  REFRESH_COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('lax'),
  REFRESH_COOKIE_PATH: z.string().default('/api/v1/auth'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  CORS_ORIGINS: z
    .string()
    .default(
      'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173',
    ),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(200),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  SWAGGER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  CRON_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false' && v !== '0'),
  CRON_RECONCILE_SCHEDULE: z.string().default('*/5 * * * *'),
  /** Shared secret for Vercel Cron / manual reconcile HTTP trigger */
  CRON_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

const e = parsed.data;

export const env = {
  ...e,
  isProd: e.NODE_ENV === 'production',
  isTest: e.NODE_ENV === 'test',
  isVercel: Boolean(process.env.VERCEL),
  corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  swaggerEnabled: e.SWAGGER_ENABLED ?? e.NODE_ENV !== 'production',
  // node-cron does not run on Vercel — use platform Cron hitting /internal/cron/reconcile
  cronEnabled: process.env.VERCEL ? false : (e.CRON_ENABLED ?? true),
  databaseSsl: e.DATABASE_SSL ?? false,
  refreshCookieSecure: e.REFRESH_COOKIE_SECURE ?? e.NODE_ENV === 'production',
  logPretty: e.LOG_PRETTY ?? e.NODE_ENV !== 'production',
  // Serverless: keep pool tiny
  DATABASE_POOL_MAX: process.env.VERCEL ? Math.min(e.DATABASE_POOL_MAX, 3) : e.DATABASE_POOL_MAX,
};

export type Env = typeof env;
