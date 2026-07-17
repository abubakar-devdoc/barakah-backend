import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { withTransaction } from '../db/pool.js';
import { emitCampaignEvent } from '../socket/index.js';

let task: cron.ScheduledTask | null = null;

export function startCronJobs(): void {
  if (!env.cronEnabled || env.isTest) {
    logger.info('Cron disabled');
    return;
  }

  task = cron.schedule(env.CRON_RECONCILE_SCHEDULE, () => {
    void reconcile().catch((err) => logger.error({ err }, 'Cron reconcile failed'));
  });

  logger.info({ schedule: env.CRON_RECONCILE_SCHEDULE }, 'Cron jobs started');
}

export function stopCronJobs(): void {
  task?.stop();
  task = null;
}

async function reconcile(): Promise<void> {
  await withTransaction({ platformRole: 'super_admin', userId: null }, async (db) => {
    // Advisory lock so only one instance runs reconcile
    const lock = await db.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(8723641) AS locked`,
    );
    if (!lock.rows[0]?.locked) return;

    try {
      // Expire old sessions
      await db.query(
        `UPDATE auth_sessions SET revoked_at = NOW()
         WHERE revoked_at IS NULL AND expires_at < NOW()`,
      );

      // Expire OTPs
      await db.query(
        `UPDATE password_reset_otps SET consumed_at = NOW()
         WHERE consumed_at IS NULL AND expires_at < NOW()`,
      );

      // Recompute stats + try complete active Quran campaigns
      const { rows: campaigns } = await db.query<{ id: string }>(
        `SELECT id FROM campaigns
         WHERE deleted_at IS NULL AND status = 'active' AND campaign_type LIKE 'quran_%'`,
      );

      for (const c of campaigns) {
        await db.query(`SELECT recompute_campaign_assignment_stats($1)`, [c.id]);
        const { rows } = await db.query<{ done: boolean }>(
          `SELECT try_complete_quran_campaign($1) AS done`,
          [c.id],
        );
        if (rows[0]?.done) {
          emitCampaignEvent(c.id, 'campaign:completed', { campaignId: c.id });
        }
      }

      // Publish pending outbox (best-effort emit)
      const { rows: events } = await db.query<{
        id: string;
        aggregate_id: string;
        event_type: string;
        payload: Record<string, unknown>;
      }>(
        `SELECT id, aggregate_id, event_type, payload
         FROM outbox_events
         WHERE status = 'pending' AND available_at <= NOW()
         ORDER BY created_at
         LIMIT 100
         FOR UPDATE SKIP LOCKED`,
      );

      for (const ev of events) {
        try {
          emitCampaignEvent(ev.aggregate_id, ev.event_type, ev.payload);
          await db.query(
            `UPDATE outbox_events
             SET status = 'published', published_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [ev.id],
          );
        } catch (err) {
          await db.query(
            `UPDATE outbox_events
             SET status = 'failed', attempts = attempts + 1,
                 last_error = $2, available_at = NOW() + INTERVAL '1 minute', updated_at = NOW()
             WHERE id = $1`,
            [ev.id, err instanceof Error ? err.message : 'publish failed'],
          );
        }
      }
    } finally {
      await db.query(`SELECT pg_advisory_unlock(8723641)`);
    }
  });
}

export { reconcile };
