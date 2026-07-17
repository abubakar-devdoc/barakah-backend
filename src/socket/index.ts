import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { identityFromAuth, withTransaction } from '../db/pool.js';

let io: Server | null = null;

export function getIo(): Server | null {
  return io;
}

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigins,
      credentials: true,
    },
    path: '/socket.io',
  });

  io.use((socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.headers.authorization?.startsWith('Bearer ')
          ? socket.handshake.headers.authorization.slice(7)
          : undefined);
      if (!token) {
        next(new Error('Unauthorized'));
        return;
      }
      const claims = verifyAccessToken(token);
      socket.data.auth = {
        userId: claims.sub,
        platformRole: claims.platform_role,
        orgId: claims.org_id,
        orgRole: claims.org_role,
        mustChangePassword: Boolean(claims.must_change_password),
        jti: claims.jti,
      };
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    logger.info({ userId: socket.data.auth?.userId }, 'Socket connected');

    socket.on('campaign:join', async (payload: { campaignId?: string }, ack?: (r: unknown) => void) => {
      try {
        const campaignId = payload?.campaignId;
        if (!campaignId) {
          ack?.({ ok: false, error: 'campaignId required' });
          return;
        }
        const auth = socket.data.auth;
        const allowed = await withTransaction(identityFromAuth(auth), async (db) => {
          if (auth.platformRole === 'super_admin') return true;
          const { rows } = await db.query<{ ok: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM campaign_members cm
               WHERE cm.campaign_id = $1 AND cm.user_id = $2
                 AND cm.status = 'active' AND cm.deleted_at IS NULL
             ) OR EXISTS (
               SELECT 1 FROM campaigns c
               JOIN organization_members m ON m.organization_id = c.organization_id
               WHERE c.id = $1 AND m.user_id = $2 AND m.status = 'active' AND m.deleted_at IS NULL
             ) AS ok`,
            [campaignId, auth.userId],
          );
          return Boolean(rows[0]?.ok);
        });
        if (!allowed) {
          ack?.({ ok: false, error: 'Forbidden' });
          return;
        }
        await socket.join(`campaign:${campaignId}`);
        ack?.({ ok: true, room: `campaign:${campaignId}` });
      } catch (err) {
        logger.warn({ err }, 'campaign:join failed');
        ack?.({ ok: false, error: 'Join failed' });
      }
    });

    socket.on('campaign:leave', async (payload: { campaignId?: string }) => {
      if (payload?.campaignId) {
        await socket.leave(`campaign:${payload.campaignId}`);
      }
    });

    socket.on('disconnect', () => {
      logger.debug({ userId: socket.data.auth?.userId }, 'Socket disconnected');
    });
  });

  return io;
}

export function emitCampaignEvent(campaignId: string, event: string, payload: unknown): void {
  if (!io) return;
  const room = `campaign:${campaignId}`;
  io.to(room).emit(event, payload);
  // Canonical UI refresh event for all campaign mutations
  if (event !== 'campaign:updated') {
    io.to(room).emit('campaign:updated', { campaignId, event, payload });
  }
}

export async function closeSocket(): Promise<void> {
  if (!io) return;
  await new Promise<void>((resolve) => {
    io!.close(() => resolve());
  });
  io = null;
}
