import pino from 'pino';
import { env } from './env.js';

// pino-pretty is a devDependency and breaks Vercel/serverless cold starts.
const usePretty = env.logPretty && !env.isVercel && !env.isProd;

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: usePretty
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      }
    : undefined,
  base: { service: 'barakah-api' },
});
