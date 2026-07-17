import { identityFromAuth, withTransaction } from '../db/pool.js';
import type { AuthContext } from '../models/types.js';
import {
  AssignmentRepository,
  AuditRepository,
  CampaignRepository,
  DhikrRepository,
  OrganizationRepository,
} from '../repositories/campaign.repository.js';
import {
  distributeJuz,
  isDhikrCampaignType,
  isQuranCampaignType,
  validateManualJuzAssignments,
} from '../utils/juz-distribution.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';

function assignmentMode(campaign: { config?: unknown }): 'open' | 'admin' {
  const config =
    campaign.config && typeof campaign.config === 'object'
      ? (campaign.config as Record<string, unknown>)
      : {};
  return config.assignmentMode === 'open' ? 'open' : 'admin';
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

function assertOrgAdmin(auth: AuthContext): void {
  if (auth.platformRole === 'super_admin') return;
  if (auth.orgRole === 'org_owner' || auth.orgRole === 'org_admin') return;
  throw forbidden('Organization admin required');
}

function mapCampaign(row: Record<string, unknown>) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    purpose: row.purpose,
    deceasedName: row.deceased_name,
    category: row.category,
    visibility: row.visibility,
    campaignType: row.campaign_type,
    status: row.status,
    targetDate: row.target_date,
    targetCount: row.target_count != null ? Number(row.target_count) : null,
    config: row.config,
    version: row.version,
    completedAt: row.completed_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAssignment(row: Record<string, unknown>) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    userId: row.user_id,
    scopeType: row.scope_type,
    juzNumber: row.juz_number,
    surahNumber: row.surah_number,
    ayahStart: row.ayah_start,
    ayahEnd: row.ayah_end,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationSeconds: row.duration_seconds,
    progressPct: Number(row.progress_pct),
    version: row.version,
    notes: row.notes,
    campaignName: row.campaign_name ?? null,
    user:
      row.full_name || row.email
        ? {
            id: row.user_id,
            name: row.full_name ?? row.email,
            email: row.email ?? null,
          }
        : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class OrganizationService {
  async create(
    auth: AuthContext,
    input: { name: string; slug: string; orgType: string; settings?: Record<string, unknown> },
  ) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const orgs = new OrganizationRepository(db);
      const org = await orgs.create({
        name: input.name,
        slug: input.slug,
        orgType: input.orgType,
        settings: input.settings,
        createdBy: auth.userId,
      });
      await orgs.addMember({
        organizationId: org.id,
        userId: auth.userId,
        role: 'org_owner',
        invitedBy: auth.userId,
      });
      return {
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          orgType: org.org_type,
          settings: org.settings,
          createdAt: org.created_at,
        },
      };
    });
  }

  async listMine(auth: AuthContext) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const orgs = new OrganizationRepository(db);
      if (auth.platformRole === 'super_admin') {
        const { rows } = await db.query(
          `SELECT * FROM organizations WHERE deleted_at IS NULL ORDER BY name`,
        );
        return {
          items: rows.map((o) => ({
            id: o.id,
            name: o.name,
            slug: o.slug,
            orgType: o.org_type,
            settings: o.settings,
          })),
        };
      }
      const list = await orgs.listForUser(auth.userId);
      return {
        items: list.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          orgType: o.org_type,
          settings: o.settings,
        })),
      };
    });
  }

  async get(auth: AuthContext, orgId: string) {
    return withTransaction(identityFromAuth({ ...auth, orgId }), async (db) => {
      const orgs = new OrganizationRepository(db);
      const org = await orgs.findById(orgId);
      if (!org) throw notFound('Organization not found');
      const members = await orgs.listMembers(orgId);
      return {
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          orgType: org.org_type,
          settings: org.settings,
        },
        members: members.map((m) => ({
          userId: m.user_id,
          role: m.role,
          status: m.status,
        })),
      };
    });
  }

  async addMember(
    auth: AuthContext,
    orgId: string,
    input: { userId: string; role: string },
  ) {
    assertOrgAdmin({ ...auth, orgId });
    return withTransaction(identityFromAuth({ ...auth, orgId }), async (db) => {
      const orgs = new OrganizationRepository(db);
      const member = await orgs.addMember({
        organizationId: orgId,
        userId: input.userId,
        role: input.role,
        invitedBy: auth.userId,
      });
      return {
        membership: {
          organizationId: member.organization_id,
          userId: member.user_id,
          role: member.role,
          status: member.status,
        },
      };
    });
  }

  async updateMember(
    auth: AuthContext,
    orgId: string,
    userId: string,
    patch: { role?: string; status?: string },
  ) {
    assertOrgAdmin({ ...auth, orgId });
    return withTransaction(identityFromAuth({ ...auth, orgId }), async (db) => {
      const orgs = new OrganizationRepository(db);
      const member = await orgs.updateMember(orgId, userId, patch);
      if (!member) throw notFound('Membership not found');
      return {
        membership: {
          organizationId: member.organization_id,
          userId: member.user_id,
          role: member.role,
          status: member.status,
        },
      };
    });
  }
}

export class CampaignService {
  async create(
    auth: AuthContext,
    input: {
      organizationId: string;
      name: string;
      description?: string;
      purpose?: string;
      deceasedName?: string;
      category: string;
      visibility: string;
      campaignType: string;
      targetDate?: string;
      targetCount?: number;
      config?: Record<string, unknown>;
      dhikrText?: string;
      dhikrTextArabic?: string;
      allowSelfJoin?: boolean;
      memberUserIds?: string[];
    },
  ) {
    assertOrgAdmin({ ...auth, orgId: input.organizationId });

    if (isDhikrCampaignType(input.campaignType)) {
      if (!input.targetCount) throw badRequest('Dhikr campaigns require targetCount');
      if (!input.dhikrText) throw badRequest('Dhikr campaigns require dhikrText');
    }

    return withTransaction(
      identityFromAuth({ ...auth, orgId: input.organizationId }),
      async (db) => {
        const campaigns = new CampaignRepository(db);
        const audit = new AuditRepository(db);
        const campaign = await campaigns.create({
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          purpose: input.purpose,
          deceasedName: input.deceasedName,
          category: input.category,
          visibility: input.visibility,
          campaignType: input.campaignType,
          targetDate: input.targetDate,
          targetCount: input.targetCount,
          config: input.config,
          createdBy: auth.userId,
        });
        await campaigns.ensureStats(campaign.id);

        if (isDhikrCampaignType(input.campaignType)) {
          await campaigns.upsertDhikrConfig({
            campaignId: campaign.id,
            dhikrText: input.dhikrText!,
            dhikrTextArabic: input.dhikrTextArabic,
            allowSelfJoin: input.allowSelfJoin ?? true,
          });
        }

        const memberIds = new Set(input.memberUserIds ?? []);
        memberIds.add(auth.userId);
        await campaigns.addMembers(campaign.id, [...memberIds], 'participant');

        await audit.write({
          actorUserId: auth.userId,
          organizationId: input.organizationId,
          action: 'campaign.create',
          entityType: 'campaign',
          entityId: campaign.id,
          after: { name: campaign.name, type: campaign.campaign_type },
        });
        await audit.enqueueOutbox({
          aggregateType: 'campaign',
          aggregateId: campaign.id,
          eventType: 'campaign.created',
          payload: { campaignId: campaign.id, organizationId: campaign.organization_id },
        });

        return { campaign: mapCampaign(campaign as unknown as Record<string, unknown>) };
      },
    );
  }

  async list(
    auth: AuthContext,
    query: { organizationId?: string; status?: string; page: number; limit: number },
  ) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const campaigns = new CampaignRepository(db);
      const result = await campaigns.list({
        organizationId: query.organizationId,
        status: query.status,
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      });
      return {
        items: result.rows.map((c) => mapCampaign(c as unknown as Record<string, unknown>)),
        page: query.page,
        limit: query.limit,
        total: result.total,
      };
    });
  }

  async get(auth: AuthContext, campaignId: string) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const campaigns = new CampaignRepository(db);
      const campaign = await campaigns.findById(campaignId);
      if (!campaign) throw notFound('Campaign not found');
      const stats = await campaigns.getProgressView(campaignId);
      const members = await campaigns.listMembers(campaignId);
      let dhikrConfig = null;
      if (isDhikrCampaignType(campaign.campaign_type)) {
        const dhikr = new DhikrRepository(db);
        dhikrConfig = await dhikr.getConfig(campaignId);
      }
      return {
        campaign: mapCampaign(campaign as unknown as Record<string, unknown>),
        progress: stats,
        members,
        dhikrConfig,
      };
    });
  }

  async update(auth: AuthContext, campaignId: string, patch: Record<string, unknown>) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const campaigns = new CampaignRepository(db);
      const existing = await campaigns.findById(campaignId);
      if (!existing) throw notFound('Campaign not found');
      assertOrgAdmin({ ...auth, orgId: existing.organization_id });
      const updated = await campaigns.update(campaignId, patch);
      return { campaign: mapCampaign(updated as unknown as Record<string, unknown>) };
    });
  }

  async setLifecycle(
    auth: AuthContext,
    campaignId: string,
    status: string,
    version?: number,
  ) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const campaigns = new CampaignRepository(db);
      const audit = new AuditRepository(db);
      const existing = await campaigns.findById(campaignId);
      if (!existing) throw notFound('Campaign not found');
      assertOrgAdmin({ ...auth, orgId: existing.organization_id });

      const allowed: Record<string, string[]> = {
        draft: ['active', 'archived'],
        active: ['completed', 'archived'],
        completed: ['archived'],
        archived: [],
      };
      if (existing.status !== status && !allowed[existing.status]?.includes(status)) {
        throw conflict(`Cannot transition from ${existing.status} to ${status}`);
      }

      const updated = await campaigns.setStatus(campaignId, status, version);
      if (!updated) throw conflict('Campaign version conflict or invalid transition');

      await audit.write({
        actorUserId: auth.userId,
        organizationId: existing.organization_id,
        action: 'campaign.lifecycle',
        entityType: 'campaign',
        entityId: campaignId,
        before: { status: existing.status },
        after: { status },
      });
      await audit.enqueueOutbox({
        aggregateType: 'campaign',
        aggregateId: campaignId,
        eventType: `campaign.${status}`,
        payload: { campaignId, status },
      });

      return { campaign: mapCampaign(updated as unknown as Record<string, unknown>) };
    });
  }

  async softDelete(auth: AuthContext, campaignId: string) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const campaigns = new CampaignRepository(db);
      const existing = await campaigns.findById(campaignId);
      if (!existing) throw notFound('Campaign not found');
      assertOrgAdmin({ ...auth, orgId: existing.organization_id });
      await campaigns.softDelete(campaignId);
      return { deleted: true };
    });
  }

  async addMembers(
    auth: AuthContext,
    campaignId: string,
    userIds: string[],
    role: string,
  ) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const campaigns = new CampaignRepository(db);
      const existing = await campaigns.findById(campaignId);
      if (!existing) throw notFound('Campaign not found');
      assertOrgAdmin({ ...auth, orgId: existing.organization_id });
      await campaigns.addMembers(campaignId, userIds, role);
      return { added: userIds.length };
    });
  }

  /**
   * Self-join for org members.
   * Dhikr campaigns are open to join by default (collective counting).
   * Quran open-mode campaigns can also be joined so members can claim a Juz.
   * Quran admin-mode campaigns stay invite/assign only.
   */
  async join(auth: AuthContext, campaignId: string) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const campaigns = new CampaignRepository(db);
      const dhikr = new DhikrRepository(db);
      const existing = await campaigns.findById(campaignId);
      if (!existing) throw notFound('Campaign not found');
      if (existing.status !== 'active') {
        throw conflict('Only active campaigns can be joined');
      }

      if (isDhikrCampaignType(existing.campaign_type)) {
        // Collective counting: org members may always join active Dhikr campaigns.
        // allow_self_join=false is reserved for future invite-only mode; currently open.
        const config = await dhikr.getConfig(campaignId);
        const allowSelfJoin = config?.allow_self_join !== false;
        if (!allowSelfJoin) {
          throw forbidden('This Dhikr campaign is invite-only');
        }
      } else if (isQuranCampaignType(existing.campaign_type)) {
        if (assignmentMode(existing) !== 'open') {
          throw forbidden(
            'This Quran campaign is admin-managed. Wait for a Juz assignment.',
          );
        }
      } else {
        throw badRequest('Unsupported campaign type');
      }

      await campaigns.addMembers(campaignId, [auth.userId], 'participant');
      return { joined: true, campaignId };
    });
  }

  async suggestDistribution(
    auth: AuthContext,
    campaignId: string,
    userIds: string[],
    juzNumbers?: number[],
  ) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const campaigns = new CampaignRepository(db);
      const existing = await campaigns.findById(campaignId);
      if (!existing) throw notFound('Campaign not found');
      if (!isQuranCampaignType(existing.campaign_type)) {
        throw badRequest('Juz distribution only applies to Quran campaigns');
      }
      const plan = distributeJuz(userIds, juzNumbers);
      return { plan };
    });
  }

  async distributeAndPersist(
    auth: AuthContext,
    campaignId: string,
    userIds: string[],
    juzNumbers?: number[],
  ) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const campaigns = new CampaignRepository(db);
      const assignments = new AssignmentRepository(db);
      const existing = await campaigns.lock(campaignId);
      if (!existing) throw notFound('Campaign not found');
      assertOrgAdmin({ ...auth, orgId: existing.organization_id });
      if (!isQuranCampaignType(existing.campaign_type)) {
        throw badRequest('Juz distribution only applies to Quran campaigns');
      }
      if (existing.status === 'completed' || existing.status === 'archived') {
        throw conflict('Cannot modify assignments on a closed campaign');
      }
      if (assignmentMode(existing) === 'open') {
        throw conflict('Open campaigns use member claims; assign only remaining Juz manually');
      }
      if (await assignments.hasProgressed(campaignId)) {
        throw conflict('Cannot replace assignments after reading has started');
      }

      const plan = distributeJuz(userIds, juzNumbers);
      const assignedUserIds = plan.map((item) => item.userId);
      const skippedUserIds = [...new Set(userIds)].filter((id) => !assignedUserIds.includes(id));
      await campaigns.addMembers(campaignId, assignedUserIds, 'participant');
      await assignments.softDeleteForCampaign(campaignId);

      const rows = plan.flatMap((p) =>
        p.juzNumbers.map((juz) => ({
          campaignId,
          userId: p.userId,
          scopeType: 'juz' as const,
          juzNumber: juz,
          createdBy: auth.userId,
        })),
      );
      const created = await assignments.createMany(rows);
      await campaigns.recomputeStats(campaignId);

      return {
        plan,
        skippedUserIds,
        assignments: created.map((a) => mapAssignment(a as unknown as Record<string, unknown>)),
      };
    });
  }

  async manualAssign(
    auth: AuthContext,
    campaignId: string,
    input: {
      assignments: Array<{ userId: string; juzNumbers: number[] }>;
      replaceExisting?: boolean;
    },
  ) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const campaigns = new CampaignRepository(db);
      const assignments = new AssignmentRepository(db);
      const existing = await campaigns.lock(campaignId);
      if (!existing) throw notFound('Campaign not found');
      assertOrgAdmin({ ...auth, orgId: existing.organization_id });
      if (!isQuranCampaignType(existing.campaign_type)) {
        throw badRequest('Juz assignments only apply to Quran campaigns');
      }
      if (existing.status === 'completed' || existing.status === 'archived') {
        throw conflict('Cannot modify assignments on a closed campaign');
      }

      const replaceExisting = input.replaceExisting !== false;
      if (replaceExisting && assignmentMode(existing) === 'open') {
        throw conflict('Cannot replace member claims in an open campaign');
      }
      const validation = validateManualJuzAssignments(
        input.assignments,
        Array.from({ length: 30 }, (_, i) => i + 1),
        replaceExisting,
      );
      if (!validation.ok) throw badRequest(validation.reason);

      if (replaceExisting && (await assignments.hasProgressed(campaignId))) {
        throw conflict('Cannot replace assignments after reading has started');
      }

      if (replaceExisting) {
        await assignments.softDeleteForCampaign(campaignId);
      }

      const userIds = input.assignments.map((a) => a.userId);
      await campaigns.addMembers(campaignId, userIds, 'participant');

      const rows = input.assignments.flatMap((a) =>
        a.juzNumbers.map((juz) => ({
          campaignId,
          userId: a.userId,
          scopeType: 'juz' as const,
          juzNumber: juz,
          createdBy: auth.userId,
        })),
      );
      let created;
      try {
        created = await assignments.createMany(rows);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('One or more selected Juz are already assigned');
        }
        throw error;
      }
      await campaigns.recomputeStats(campaignId);
      return {
        assignments: created.map((a) => mapAssignment(a as unknown as Record<string, unknown>)),
      };
    });
  }

  async assignmentAvailability(auth: AuthContext, campaignId: string) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const campaigns = new CampaignRepository(db);
      const assignments = new AssignmentRepository(db);
      const campaign = await campaigns.findById(campaignId);
      if (!campaign) throw notFound('Campaign not found');
      if (!isQuranCampaignType(campaign.campaign_type)) {
        throw badRequest('Juz availability only applies to Quran campaigns');
      }
      const claimed = await assignments.listClaimedJuz(campaignId);
      const claimedSet = new Set(claimed);
      return {
        assignmentMode: assignmentMode(campaign),
        availableJuz: Array.from({ length: 30 }, (_, i) => i + 1).filter(
          (juz) => !claimedSet.has(juz),
        ),
        claimedJuz: claimed,
      };
    });
  }

  async claimJuz(auth: AuthContext, campaignId: string, juzNumber: number) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const campaigns = new CampaignRepository(db);
      const assignments = new AssignmentRepository(db);
      const audit = new AuditRepository(db);
      const campaign = await campaigns.lock(campaignId);
      if (!campaign) throw notFound('Campaign not found');
      if (!isQuranCampaignType(campaign.campaign_type)) {
        throw badRequest('Juz claims only apply to Quran campaigns');
      }
      if (assignmentMode(campaign) !== 'open') {
        throw forbidden('This campaign is managed by an admin');
      }
      if (campaign.status !== 'active') {
        throw conflict('Claims are only available while the campaign is active');
      }
      if (await assignments.countForUser(campaignId, auth.userId)) {
        throw conflict('You already have an active Juz in this campaign');
      }

      await campaigns.addMembers(campaignId, [auth.userId], 'participant');

      let created;
      try {
        [created] = await assignments.createMany([
          {
            campaignId,
            userId: auth.userId,
            scopeType: 'juz',
            juzNumber,
            createdBy: auth.userId,
          },
        ]);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict(`Juz ${juzNumber} has already been claimed`);
        }
        throw error;
      }

      await campaigns.recomputeStats(campaignId);
      await audit.write({
        actorUserId: auth.userId,
        organizationId: campaign.organization_id,
        action: 'assignment.self_claim',
        entityType: 'quran_assignment',
        entityId: created!.id,
        after: { campaignId, juzNumber },
      });

      return {
        assignment: mapAssignment(created as unknown as Record<string, unknown>),
      };
    });
  }

  async listAssignments(auth: AuthContext, campaignId: string) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const assignments = new AssignmentRepository(db);
      const rows = await assignments.listByCampaign(campaignId);
      return {
        items: rows.map((a) => mapAssignment(a as unknown as Record<string, unknown>)),
      };
    });
  }

  async myAssignments(auth: AuthContext, campaignId?: string) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const assignments = new AssignmentRepository(db);
      const rows = await assignments.listMine(auth.userId, campaignId);
      return {
        items: rows.map((a) => mapAssignment(a as unknown as Record<string, unknown>)),
      };
    });
  }

  async getAssignment(auth: AuthContext, assignmentId: string) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const assignments = new AssignmentRepository(db);
      const current = await assignments.findById(assignmentId);
      if (!current) throw notFound('Assignment not found');

      if (
        current.user_id !== auth.userId &&
        auth.platformRole !== 'super_admin' &&
        auth.orgRole !== 'org_owner' &&
        auth.orgRole !== 'org_admin'
      ) {
        throw forbidden('Not allowed to view this assignment');
      }

      const { rows } = await db.query(
        `SELECT a.*, c.name AS campaign_name, u.full_name, u.email
         FROM quran_assignments a
         JOIN campaigns c ON c.id = a.campaign_id
         JOIN users u ON u.id = a.user_id
         WHERE a.id = $1 AND a.deleted_at IS NULL`,
        [assignmentId],
      );
      return {
        assignment: mapAssignment(rows[0] as unknown as Record<string, unknown>),
      };
    });
  }

  async startAssignment(auth: AuthContext, assignmentId: string) {
    return this.transitionAssignment(auth, assignmentId, 'started', ['pending'], {});
  }

  async completeAssignment(
    auth: AuthContext,
    assignmentId: string,
    input: { durationSeconds?: number; version?: number },
  ) {
    return this.transitionAssignment(auth, assignmentId, 'completed', ['pending', 'started'], input);
  }

  async skipAssignment(
    auth: AuthContext,
    assignmentId: string,
    input: { reason?: string; version?: number },
  ) {
    return this.transitionAssignment(auth, assignmentId, 'skipped', ['pending', 'started'], {
      version: input.version,
      notes: input.reason,
      requireOrgAdmin: true,
    });
  }

  private async transitionAssignment(
    auth: AuthContext,
    assignmentId: string,
    toStatus: string,
    fromStatuses: string[],
    input: {
      durationSeconds?: number;
      version?: number;
      notes?: string;
      requireOrgAdmin?: boolean;
    },
  ) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const assignments = new AssignmentRepository(db);
      const campaigns = new CampaignRepository(db);
      const audit = new AuditRepository(db);

      const current = await assignments.findById(assignmentId);
      if (!current) throw notFound('Assignment not found');

      const campaign = await campaigns.findById(current.campaign_id);
      if (!campaign) throw notFound('Campaign not found');
      if (campaign.status !== 'active') throw conflict('Campaign is not active');

      if (input.requireOrgAdmin) {
        assertOrgAdmin({ ...auth, orgId: campaign.organization_id });
      } else if (
        current.user_id !== auth.userId &&
        auth.platformRole !== 'super_admin'
      ) {
        throw forbidden('You can only update your own assignments');
      }

      const updated = await assignments.transitionStatus({
        id: assignmentId,
        toStatus,
        fromStatuses,
        version: input.version,
        durationSeconds: input.durationSeconds,
        notes: input.notes,
      });
      if (!updated) throw conflict('Assignment status conflict');

      await assignments.logProgress({
        assignmentId,
        userId: auth.userId,
        fromStatus: current.status,
        toStatus,
        meta: { durationSeconds: input.durationSeconds },
      });
      await campaigns.recomputeStats(current.campaign_id);

      let campaignCompleted = false;
      if (toStatus === 'completed' || toStatus === 'skipped') {
        campaignCompleted = await campaigns.tryComplete(current.campaign_id);
      }

      await audit.enqueueOutbox({
        aggregateType: 'campaign',
        aggregateId: current.campaign_id,
        eventType: campaignCompleted ? 'campaign.completed' : 'assignment.updated',
        payload: {
          campaignId: current.campaign_id,
          assignmentId,
          status: toStatus,
          campaignCompleted,
        },
      });

      return {
        assignment: mapAssignment(updated as unknown as Record<string, unknown>),
        campaignCompleted,
      };
    });
  }

  async progress(auth: AuthContext, campaignId: string) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const campaigns = new CampaignRepository(db);
      const assignments = new AssignmentRepository(db);
      const progress = await campaigns.getProgressView(campaignId);
      if (!progress) throw notFound('Campaign not found');
      const items = await assignments.listByCampaign(campaignId);
      return {
        progress,
        assignments: items.map((a) => mapAssignment(a as unknown as Record<string, unknown>)),
      };
    });
  }
}

export class DhikrService {
  async getCampaignData(auth: AuthContext, campaignId: string) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const campaigns = new CampaignRepository(db);
      const dhikr = new DhikrRepository(db);
      const campaign = await campaigns.findById(campaignId);
      if (!campaign) throw notFound('Campaign not found');
      if (!isDhikrCampaignType(campaign.campaign_type)) {
        throw badRequest('Not a Dhikr campaign');
      }
      const config = await dhikr.getConfig(campaignId);
      const progress = await campaigns.getProgressView(campaignId);
      const myCount = await dhikr.myTotal(campaignId, auth.userId);
      const leaderboard = await dhikr.leaderboard(campaignId);
      return {
        campaign: mapCampaign(campaign as unknown as Record<string, unknown>),
        config,
        progress,
        myCount,
        leaderboard: leaderboard.map((r) => ({
          userId: r.user_id,
          fullName: r.full_name,
          email: r.email,
          count: Number(r.count),
          updatedAt: r.updated_at,
        })),
      };
    });
  }

  async submitBatch(
    auth: AuthContext,
    campaignId: string,
    input: { clientBatchId: string; delta: number },
  ) {
    return withTransaction(identityFromAuth(auth), async (db) => {
      const campaigns = new CampaignRepository(db);
      const dhikr = new DhikrRepository(db);
      const audit = new AuditRepository(db);
      const campaign = await campaigns.findById(campaignId);
      if (!campaign) throw notFound('Campaign not found');
      if (!isDhikrCampaignType(campaign.campaign_type)) {
        throw badRequest('Not a Dhikr campaign');
      }
      if (campaign.status !== 'active') {
        throw conflict('Campaign is not active');
      }

      // Dhikr is collective counting — joining happens implicitly when counting.
      await campaigns.addMembers(campaignId, [auth.userId], 'participant');

      const result = await dhikr.applyBatch({
        campaignId,
        userId: auth.userId,
        clientBatchId: input.clientBatchId,
        delta: input.delta,
      });

      await audit.enqueueOutbox({
        aggregateType: 'campaign',
        aggregateId: campaignId,
        eventType: result.campaign_completed ? 'campaign.completed' : 'dhikr.batch',
        payload: {
          campaignId,
          userId: auth.userId,
          personalCount: Number(result.personal_count),
          globalCount: Number(result.global_count),
          applied: result.applied,
        },
      });

      return {
        personalCount: Number(result.personal_count),
        globalCount: Number(result.global_count),
        applied: result.applied,
        campaignCompleted: result.campaign_completed,
      };
    });
  }
}

export const organizationService = new OrganizationService();
export const campaignService = new CampaignService();
export const dhikrService = new DhikrService();
