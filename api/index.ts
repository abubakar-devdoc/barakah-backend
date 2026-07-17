/**
 * Vercel serverless entry.
 * Loads the compiled Express app from `dist/` (produced by `npm run build`).
 * Bootstrap failures return JSON instead of a blank FUNCTION_INVOCATION_FAILED page.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';

type ExpressApp = Express & ((req: IncomingMessage, res: ServerResponse) => void);

let app: ExpressApp | null = null;
let bootError: Error | null = null;

async function loadApp(): Promise<ExpressApp> {
  if (app) return app;
  if (bootError) throw bootError;

  try {
    // Prefer compiled output — Vercel runs `npm run build` before packaging.
    const { createApp } = await import('../dist/src/app.js');
    app = createApp() as ExpressApp;
    return app;
  } catch (err) {
    bootError = err instanceof Error ? err : new Error(String(err));
    console.error('BARAKAH_BOOTSTRAP_FAILED', bootError);
    throw bootError;
  }
}

function sendBootError(res: ServerResponse, err: Error): void {
  res.statusCode = 500;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(
    JSON.stringify({
      success: false,
      error: {
        code: 'BOOTSTRAP_FAILED',
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
      },
    }),
  );
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const expressApp = await loadApp();
    expressApp(req, res);
  } catch (err) {
    sendBootError(res, err instanceof Error ? err : new Error(String(err)));
  }
}
