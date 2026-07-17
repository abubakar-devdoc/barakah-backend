import type { NextFunction, Request, Response } from 'express';
import { withTransaction } from '../db/pool.js';
import type { OrgRole } from '../models/types.js';

/**
 * Optional: bind organization context from X-Organization-Id header
 * and load the caller's membership role into req.auth.
 */
export function resolveOrgContext(req: Request, _res: Response, next: NextFunction): void {
  void (async () => {
    if (!req.auth) {
      next();
      return;
    }
    const headerOrg = req.header('x-organization-id')?.trim();
    const orgId = headerOrg || req.auth.orgId || req.body?.organizationId || req.params.orgId;
    if (!orgId || typeof orgId !== 'string') {
      next();
      return;
    }

    if (req.auth.platformRole === 'super_admin') {
      req.auth = { ...req.auth, orgId, orgRole: req.auth.orgRole ?? 'org_owner' };
      next();
      return;
    }

    try {
      const membership = await withTransaction(
        { userId: req.auth.userId, platformRole: req.auth.platformRole },
        async (db) => {
          const { rows } = await db.query<{ role: OrgRole; status: string }>(
            `SELECT role, status FROM organization_members
             WHERE organization_id = $1 AND user_id = $2
               AND deleted_at IS NULL AND status = 'active'
             LIMIT 1`,
            [orgId, req.auth!.userId],
          );
          return rows[0] ?? null;
        },
      );

      if (membership) {
        req.auth = { ...req.auth, orgId, orgRole: membership.role };
      } else {
        req.auth = { ...req.auth, orgId };
      }
      next();
    } catch (err) {
      next(err);
    }
  })();
}
