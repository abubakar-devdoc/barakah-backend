import http from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closePool } from './db/pool.js';
import { startCronJobs, stopCronJobs } from './cron/reconcile.js';
import { closeSocket, initSocket } from './socket/index.js';

const app = createApp();
const server = http.createServer(app);

initSocket(server);
startCronJobs();

server.listen(env.PORT, env.HOST, () => {
  logger.info({ host: env.HOST, port: env.PORT, env: env.NODE_ENV }, 'Barakah API listening');
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Graceful shutdown started');

  stopCronJobs();

  server.close(async (err) => {
    if (err) logger.error({ err }, 'HTTP server close error');
    try {
      await closeSocket();
      await closePool();
      logger.info('Shutdown complete');
      process.exit(err ? 1 : 0);
    } catch (closeErr) {
      logger.error({ err: closeErr }, 'Error during shutdown');
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 20_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  void shutdown('uncaughtException');
});
