import express from 'express';
import * as HelmetModule from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import * as RateLimitModule from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import type { Request, RequestHandler } from 'express';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { buildApiRouter, healthRouter } from './routes/index.js';
import { openApiDocument } from './openapi/document.js';
// fix
type HelmetFactory = (options?: {
  contentSecurityPolicy?: boolean | object;
  crossOriginResourcePolicy?: { policy: string };
}) => RequestHandler;

type RateLimitFactory = (options: {
  windowMs: number;
  max: number;
  standardHeaders?: boolean;
  legacyHeaders?: boolean;
  skipSuccessfulRequests?: boolean;
  message?: unknown;
}) => RequestHandler;

/** NodeNext + CJS package typing is inconsistent on Vercel/TS 5.9 — force callable factories. */
const helmet = (
  (HelmetModule as unknown as { default?: HelmetFactory }).default ??
  (HelmetModule as unknown as HelmetFactory)
) as HelmetFactory;

const rateLimit = (
  (RateLimitModule as unknown as { default?: RateLimitFactory }).default ??
  (RateLimitModule as unknown as RateLimitFactory)
) as RateLimitFactory;

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      customProps: (req: Request) => ({ requestId: req.requestId }),
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: env.isProd ? undefined : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) {
          cb(null, true);
          return;
        }
        if (env.corsOrigins.includes(origin)) {
          cb(null, true);
          return;
        }
        // Dev: allow LAN / phone testing (e.g. http://192.168.x.x:3000)
        if (!env.isProd) {
          try {
            const { hostname, port } = new URL(origin);
            const isLocalHost =
              hostname === 'localhost' ||
              hostname === '127.0.0.1' ||
              /^192\.168\.\d+\.\d+$/.test(hostname) ||
              /^10\.\d+\.\d+\.\d+$/.test(hostname);
            const isDevFront = !port || port === '3000' || port === '5173';            if (isLocalHost && isDevFront) {
              cb(null, true);
              return;
            }
          } catch {
            // fall through
          }
        }
        cb(null, false);
      },
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Rate limiting only in production — was causing "Too Many Requests" during local HMR/refresh.
  if (env.isProd) {
    app.use(
      rateLimit({
        windowMs: env.RATE_LIMIT_WINDOW_MS,
        max: env.RATE_LIMIT_MAX,
        standardHeaders: true,
        legacyHeaders: false,
      }),
    );

    const authLimiter = rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.AUTH_RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too Many Requests' },
      },
    });

    const refreshLimiter = rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.AUTH_RATE_LIMIT_MAX * 10,
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      message: {
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too Many Requests' },
      },
    });

    app.use('/api/v1/auth/login', authLimiter);
    app.use('/api/v1/auth/refresh', refreshLimiter);
  }

  app.use(healthRouter);

  if (env.swaggerEnabled) {
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
    app.get('/openapi.json', (_req, res) => {
      res.json(openApiDocument);
    });
  }

  const api = buildApiRouter();
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
