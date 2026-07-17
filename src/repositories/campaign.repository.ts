import type { DbClient } from '../db/pool.js';
import type {
  CampaignRow,
  CampaignStatsRow,
  OrganizationMemberRow,
  OrganizationRow,
  QuranAssignmentRow,
} from '../models/types.js';

export class OrganizationRepository {
  constructor(private readonly db: DbClient) {}

  async create(input: {
    name: string;
    slug: string;
    orgType: string;
    settings?: Record<string, unknown>;
    createdBy: string;
  }): Promise<OrganizationRow> {
    const { rows } = await this.db.query<OrganizationRow>(
      `INSERT INTO organizations (name, slug, org_type, settings, created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5)
       RETURNING *`,
      [input.name, input.slug, input.orgType, JSON.stringify(input.settings ?? {}), input.createdBy],
    );
    return rows[0]!;
  }

  async findById(id: string): Promise<OrganizationRow | null> {
    const { rows } = await this.db.query<OrganizationRow>(
      `SELECT * FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listForUser(userId: string): Promise<OrganizationRow[]> {
    const { rows } = await this.db.query<OrganizationRow>(
      `SELECT o.* FROM organizations o
       JOIN organization_members m ON m.organization_id = o.id
       WHERE m.user_id = $1 AND m.status = 'active' AND m.deleted_at IS NULL
         AND o.deleted_at IS NULL
       ORDER BY o.name`,
      [userId],
    );
    return rows;
  }

  async addMember(input: {
    organizationId: string;
    userId: string;
    role: string;
    invitedBy?: string | null;
  }): Promise<OrganizationMemberRow> {
    const { rows } = await this.db.query<OrganizationMemberRow>(
      `INSERT INTO organization_members (organization_id, user_id, role, status, invited_by)
       VALUES ($1,$2,$3,'active',$4)
       ON CONFLICT (organization_id, user_id) DO UPDATE
         SET role = EXCLUDED.role,
             status = 'active',
             deleted_at = NULL,
             updated_at = NOW()
       RETURNING *`,
      [input.organizationId, input.userId, input.role, input.invitedBy ?? null],
    );
    return rows[0]!;
  }

  async listMembers(organizationId: string): Promise<OrganizationMemberRow[]> {
    const { rows } = await this.db.query<OrganizationMemberRow>(
      `SELECT * FROM organization_members
       WHERE organization_id = $1 AND deleted_at IS NULL
       ORDER BY created_at`,
      [organizationId],
    );
    return rows;
  }

  async updateMember(
    organizationId: string,
    userId: string,
    patch: { role?: string; status?: string },
  ): Promise<OrganizationMemberRow | null> {
    const { rows } = await this.db.query<OrganizationMemberRow>(
      `UPDATE organization_members
       SET role = COALESCE($3, role),
           status = COALESCE($4, status),
           updated_at = NOW(),
           deleted_at = CASE WHEN $4 = 'removed' THEN NOW() ELSE deleted_at END
       WHERE organization_id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [organizationId, userId, patch.role ?? null, patch.status ?? null],
    );
    return rows[0] ?? null;
  }
}

export class CampaignRepository {
  constructor(private readonly db: DbClient) {}

  async lock(id: string): Promise<CampaignRow | null> {
    const { rows } = await this.db.query<CampaignRow>(
      `SELECT * FROM campaigns
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [id],
    );
    return rows[0] ?? null;
  }

  async create(input: {
    organizationId: string;
    name: string;
    description?: string | null;
    purpose?: string | null;
    deceasedName?: string | null;
    category: string;
    visibility: string;
    campaignType: string;
    targetDate?: string | null;
    targetCount?: number | null;
    config?: Record<string, unknown>;
    createdBy: string;
  }): Promise<CampaignRow> {
    const { rows } = await this.db.query<CampaignRow>(
      `INSERT INTO campaigns (
         organization_id, name, description, purpose, deceased_name,
         category, visibility, campaign_type, target_date, target_count, config, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
       RETURNING *`,
      [
        input.organizationId,
        input.name,
        input.description ?? null,
        input.purpose ?? null,
        input.deceasedName ?? null,
        input.category,
        input.visibility,
        input.campaignType,
        input.targetDate ?? null,
        input.targetCount ?? null,
        JSON.stringify(input.config ?? {}),
        input.createdBy,
      ],
    );
    return rows[0]!;
  }

  async ensureStats(campaignId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO campaign_stats (campaign_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [campaignId],
    );
  }

  async upsertDhikrConfig(input: {
    campaignId: string;
    dhikrText: string;
    dhikrTextArabic?: string | null;
    allowSelfJoin?: boolean;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO dhikr_campaign_config (campaign_id, dhikr_text, dhikr_text_arabic, allow_self_join)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (campaign_id) DO UPDATE
         SET dhikr_text = EXCLUDED.dhikr_text,
             dhikr_text_arabic = EXCLUDED.dhikr_text_arabic,
             allow_self_join = EXCLUDED.allow_self_join,
             updated_at = NOW()`,
      [
        input.campaignId,
        input.dhikrText,
        input.dhikrTextArabic ?? null,
        input.allowSelfJoin ?? true,
      ],
    );
  }

  async findById(id: string): Promise<CampaignRow | null> {
    const { rows } = await this.db.query<CampaignRow>(
      `SELECT * FROM campaigns WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async list(filters: {
    organizationId?: string;
    status?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: CampaignRow[]; total: number }> {
    const where: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filters.organizationId) {
      params.push(filters.organizationId);
      where.push(`organization_id = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      where.push(`status = $${params.length}`);
    }
    const whereSql = where.join(' AND ');
    const count = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM campaigns WHERE ${whereSql}`,
      params,
    );
    params.push(filters.limit, filters.offset);
    const { rows } = await this.db.query<CampaignRow>(
      `SELECT * FROM campaigns WHERE ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { rows, total: Number(count.rows[0]?.count ?? 0) };
  }

  async update(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<CampaignRow | null> {
    const map: Record<string, string> = {
      name: 'name',
      description: 'description',
      purpose: 'purpose',
      deceasedName: 'deceased_name',
      category: 'category',
      visibility: 'visibility',
      targetDate: 'target_date',
      targetCount: 'target_count',
      config: 'config',
      status: 'status',
      completedAt: 'completed_at',
      version: 'version',
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(map)) {
      if (patch[key] !== undefined) {
        if (col === 'config') {
          fields.push(`${col} = $${i}::jsonb`);
          values.push(JSON.stringify(patch[key]));
        } else {
          fields.push(`${col} = $${i}`);
          values.push(patch[key]);
        }
        i += 1;
      }
    }
    if (!fields.length) return this.findById(id);
    values.push(id);
    const { rows } = await this.db.query<CampaignRow>(
      `UPDATE campaigns SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${i} AND deleted_at IS NULL
       RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  async setStatus(
    id: string,
    status: string,
    expectedVersion?: number,
  ): Promise<CampaignRow | null> {
    const params: unknown[] = [status, id];
    let versionClause = '';
    if (expectedVersion !== undefined) {
      params.push(expectedVersion);
      versionClause = ` AND version = $3`;
    }
    const completedAt = status === 'completed' ? 'NOW()' : 'completed_at';
    const { rows } = await this.db.query<CampaignRow>(
      `UPDATE campaigns
       SET status = $1,
           completed_at = ${completedAt},
           version = version + 1,
           updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL${versionClause}
       RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE campaigns SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  async addMembers(
    campaignId: string,
    userIds: string[],
    role: string,
  ): Promise<void> {
    const campaign = await this.findById(campaignId);
    if (!campaign) return;

    for (const userId of userIds) {
      await this.db.query(
        `INSERT INTO campaign_members (campaign_id, user_id, role, status)
         VALUES ($1,$2,$3,'active')
         ON CONFLICT (campaign_id, user_id) DO UPDATE
           SET role = EXCLUDED.role, status = 'active', deleted_at = NULL, updated_at = NOW()`,
        [campaignId, userId, role],
      );

      // Campaign participants must be org members so RLS can list campaigns & related rows.
      await this.db.query(
        `INSERT INTO organization_members (organization_id, user_id, role, status)
         VALUES ($1,$2,'member','active')
         ON CONFLICT (organization_id, user_id) DO UPDATE
           SET status = 'active',
               deleted_at = NULL,
               updated_at = NOW(),
               role = CASE
                 WHEN organization_members.role IN ('org_owner', 'org_admin')
                   THEN organization_members.role
                 ELSE 'member'
               END`,
        [campaign.organization_id, userId],
      );
    }
  }

  async listMembers(campaignId: string) {
    const { rows } = await this.db.query(
      `SELECT cm.*, u.email, u.full_name
       FROM campaign_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.campaign_id = $1 AND cm.deleted_at IS NULL
       ORDER BY cm.joined_at`,
      [campaignId],
    );
    return rows;
  }

  async getStats(campaignId: string): Promise<CampaignStatsRow | null> {
    const { rows } = await this.db.query<CampaignStatsRow>(
      `SELECT * FROM campaign_stats WHERE campaign_id = $1`,
      [campaignId],
    );
    return rows[0] ?? null;
  }

  async getProgressView(campaignId: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM v_campaign_progress WHERE campaign_id = $1`,
      [campaignId],
    );
    return rows[0] ?? null;
  }

  async recomputeStats(campaignId: string): Promise<void> {
    await this.db.query(`SELECT recompute_campaign_assignment_stats($1)`, [campaignId]);
  }

  async tryComplete(campaignId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ try_complete_quran_campaign: boolean }>(
      `SELECT try_complete_quran_campaign($1) AS try_complete_quran_campaign`,
      [campaignId],
    );
    return Boolean(rows[0]?.try_complete_quran_campaign);
  }
}

export class AssignmentRepository {
  constructor(private readonly db: DbClient) {}

  async hasProgressed(campaignId: string): Promise<boolean> {
    const { rows } = await this.db.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM quran_assignments
         WHERE campaign_id = $1
           AND deleted_at IS NULL
           AND status <> 'pending'
       ) AS exists`,
      [campaignId],
    );
    return Boolean(rows[0]?.exists);
  }

  async countForUser(campaignId: string, userId: string): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM quran_assignments
       WHERE campaign_id = $1 AND user_id = $2
         AND scope_type = 'juz' AND deleted_at IS NULL
         AND status <> 'skipped'`,
      [campaignId, userId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async listClaimedJuz(campaignId: string): Promise<number[]> {
    const { rows } = await this.db.query<{ juz_number: number }>(
      `SELECT juz_number
       FROM quran_assignments
       WHERE campaign_id = $1 AND deleted_at IS NULL
         AND scope_type = 'juz' AND juz_number IS NOT NULL
       ORDER BY juz_number`,
      [campaignId],
    );
    return rows.map((row) => row.juz_number);
  }

  async softDeleteForCampaign(campaignId: string): Promise<void> {
    await this.db.query(
      `UPDATE quran_assignments SET deleted_at = NOW(), updated_at = NOW()
       WHERE campaign_id = $1 AND deleted_at IS NULL`,
      [campaignId],
    );
  }

  async createMany(
    rows: Array<{
      campaignId: string;
      userId: string;
      scopeType: string;
      juzNumber?: number | null;
      createdBy: string;
    }>,
  ): Promise<QuranAssignmentRow[]> {
    const created: QuranAssignmentRow[] = [];
    for (const row of rows) {
      const { rows: inserted } = await this.db.query<QuranAssignmentRow>(
        `INSERT INTO quran_assignments (
           campaign_id, user_id, scope_type, juz_number, created_by
         ) VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [row.campaignId, row.userId, row.scopeType, row.juzNumber ?? null, row.createdBy],
      );
      created.push(inserted[0]!);
    }
    return created;
  }

  async listByCampaign(
    campaignId: string,
  ): Promise<(QuranAssignmentRow & { full_name?: string; email?: string })[]> {
    const { rows } = await this.db.query<
      QuranAssignmentRow & { full_name?: string; email?: string }
    >(
      `SELECT a.*, u.full_name, u.email
       FROM quran_assignments a
       JOIN users u ON u.id = a.user_id
       WHERE a.campaign_id = $1 AND a.deleted_at IS NULL
       ORDER BY a.juz_number NULLS LAST, a.created_at`,
      [campaignId],
    );
    return rows;
  }

  async listMine(
    userId: string,
    campaignId?: string,
  ): Promise<
    (QuranAssignmentRow & { campaign_name?: string; full_name?: string; email?: string })[]
  > {
    const params: unknown[] = [userId];
    let sql = `
      SELECT a.*, c.name AS campaign_name, u.full_name, u.email
      FROM quran_assignments a
      JOIN campaigns c ON c.id = a.campaign_id
      JOIN users u ON u.id = a.user_id
      WHERE a.user_id = $1 AND a.deleted_at IS NULL AND c.deleted_at IS NULL`;
    if (campaignId) {
      params.push(campaignId);
      sql += ` AND a.campaign_id = $2`;
    }
    sql += ` ORDER BY a.created_at DESC`;
    const { rows } = await this.db.query<QuranAssignmentRow & { campaign_name?: string }>(sql, params);
    return rows;
  }

  async findById(id: string): Promise<QuranAssignmentRow | null> {
    const { rows } = await this.db.query<QuranAssignmentRow>(
      `SELECT * FROM quran_assignments WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  async transitionStatus(input: {
    id: string;
    toStatus: string;
    fromStatuses: string[];
    version?: number;
    durationSeconds?: number | null;
    notes?: string | null;
  }): Promise<QuranAssignmentRow | null> {
    const params: unknown[] = [
      input.toStatus,
      input.id,
      input.fromStatuses,
      input.durationSeconds ?? null,
      input.notes ?? null,
    ];
    let versionClause = '';
    if (input.version !== undefined) {
      params.push(input.version);
      versionClause = ` AND version = $${params.length}`;
    }

    const startedAt =
      input.toStatus === 'started' ? 'COALESCE(started_at, NOW())' : 'started_at';
    const completedAt = ['completed', 'skipped'].includes(input.toStatus)
      ? 'NOW()'
      : 'completed_at';
    const progress =
      input.toStatus === 'completed' || input.toStatus === 'skipped' ? '100' : 'progress_pct';

    const { rows } = await this.db.query<QuranAssignmentRow>(
      `UPDATE quran_assignments
       SET status = $1,
           started_at = ${startedAt},
           completed_at = ${completedAt},
           duration_seconds = COALESCE($4, duration_seconds),
           notes = COALESCE($5, notes),
           progress_pct = ${progress},
           version = version + 1,
           updated_at = NOW()
       WHERE id = $2
         AND deleted_at IS NULL
         AND status = ANY($3::text[])
         ${versionClause}
       RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  }

  async logProgress(input: {
    assignmentId: string;
    userId: string;
    fromStatus: string | null;
    toStatus: string;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO assignment_progress_events (assignment_id, user_id, from_status, to_status, meta)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        input.assignmentId,
        input.userId,
        input.fromStatus,
        input.toStatus,
        JSON.stringify(input.meta ?? {}),
      ],
    );
  }
}

export class DhikrRepository {
  constructor(private readonly db: DbClient) {}

  async applyBatch(input: {
    campaignId: string;
    userId: string;
    clientBatchId: string;
    delta: number;
  }) {
    const { rows } = await this.db.query<{
      personal_count: string;
      global_count: string;
      applied: boolean;
      campaign_completed: boolean;
    }>(
      `SELECT * FROM apply_dhikr_batch($1,$2,$3,$4)`,
      [input.campaignId, input.userId, input.clientBatchId, input.delta],
    );
    return rows[0]!;
  }

  async getConfig(campaignId: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM dhikr_campaign_config WHERE campaign_id = $1`,
      [campaignId],
    );
    return rows[0] ?? null;
  }

  async leaderboard(campaignId: string, limit = 50) {
    const { rows } = await this.db.query(
      `SELECT d.user_id, d.count, d.updated_at, u.full_name, u.email
       FROM dhikr_member_totals d
       JOIN users u ON u.id = d.user_id
       WHERE d.campaign_id = $1
       ORDER BY d.count DESC, d.updated_at ASC
       LIMIT $2`,
      [campaignId, limit],
    );
    return rows;
  }

  async myTotal(campaignId: string, userId: string): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT count::text FROM dhikr_member_totals WHERE campaign_id = $1 AND user_id = $2`,
      [campaignId, userId],
    );
    return Number(rows[0]?.count ?? 0);
  }
}

export class AuditRepository {
  constructor(private readonly db: DbClient) {}

  async write(input: {
    organizationId?: string | null;
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_logs (
         organization_id, actor_user_id, action, entity_type, entity_id, before, after, ip, user_agent
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`,
      [
        input.organizationId ?? null,
        input.actorUserId ?? null,
        input.action,
        input.entityType,
        input.entityId ?? null,
        input.before ? JSON.stringify(input.before) : null,
        input.after ? JSON.stringify(input.after) : null,
        input.ip ?? null,
        input.userAgent ?? null,
      ],
    );
  }

  async enqueueOutbox(input: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1,$2,$3,$4::jsonb)`,
      [
        input.aggregateType,
        input.aggregateId,
        input.eventType,
        JSON.stringify(input.payload),
      ],
    );
  }
}
