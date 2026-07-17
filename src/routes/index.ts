import { Router } from 'express';
import {
  authController,
  campaignsController,
  orgsController,
  usersController,
} from '../controllers/index.js';
import {
  authenticate,
  requireOrgAdmin,
  requirePasswordChanged,
  requireSuperAdmin,
} from '../middleware/auth.js';
import { resolveOrgContext } from '../middleware/org-context.js';
import { asyncHandler, validateBody, validateParams, validateQuery } from '../middleware/error-handler.js';
import {
  addMembershipSchema,
  campaignIdParam,
  campaignLifecycleSchema,
  campaignMembersSchema,
  changePasswordSchema,
  claimJuzSchema,
  completeAssignmentSchema,
  createCampaignSchema,
  createOrganizationSchema,
  createUserSchema,
  dhikrBatchSchema,
  distributeJuzSchema,
  loginSchema,
  manualAssignmentsSchema,
  orgIdParam,
  paginationQuery,
  skipAssignmentSchema,
  updateCampaignSchema,
  updateMembershipSchema,
  updateUserSchema,
  userIdParam,
  assignmentIdParam,
} from '../validators/schemas.js';
import { checkDbReady } from '../db/pool.js';
import { sendSuccess } from '../utils/response.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  sendSuccess(res, { status: 'ok', service: 'barakah-api', ts: new Date().toISOString() });
});

healthRouter.get('/ready', asyncHandler(async (_req, res) => {
  const dbOk = await checkDbReady();
  if (!dbOk) {
    res.status(503).json({
      success: false,
      error: { code: 'NOT_READY', message: 'Database unavailable' },
    });
    return;
  }
  sendSuccess(res, { status: 'ready', database: true });
}));

export const authRouter = Router();
authRouter.post('/login', validateBody(loginSchema), asyncHandler(authController.login));
authRouter.post('/refresh', asyncHandler(authController.refresh));
authRouter.post('/logout', asyncHandler(authController.logout));
authRouter.post(
  '/change-password',
  authenticate,
  validateBody(changePasswordSchema),
  asyncHandler(authController.changePassword),
);
authRouter.get('/me', authenticate, asyncHandler(authController.me));

export const usersRouter = Router();
usersRouter.use(authenticate, resolveOrgContext, requirePasswordChanged);
usersRouter.post('/', requireOrgAdmin, validateBody(createUserSchema), asyncHandler(usersController.create));
usersRouter.get('/', requireOrgAdmin, validateQuery(paginationQuery), asyncHandler(usersController.list));
usersRouter.get(
  '/:userId',
  validateParams(userIdParam),
  asyncHandler(usersController.get),
);
usersRouter.patch(
  '/:userId',
  requireOrgAdmin,
  validateParams(userIdParam),
  validateBody(updateUserSchema),
  asyncHandler(usersController.update),
);
usersRouter.delete(
  '/:userId',
  requireSuperAdmin,
  validateParams(userIdParam),
  asyncHandler(usersController.remove),
);

export const orgsRouter = Router();
orgsRouter.use(authenticate, resolveOrgContext, requirePasswordChanged);
orgsRouter.post('/', validateBody(createOrganizationSchema), asyncHandler(orgsController.create));
orgsRouter.get('/', asyncHandler(orgsController.list));
orgsRouter.get('/:orgId', validateParams(orgIdParam), asyncHandler(orgsController.get));
orgsRouter.post(
  '/:orgId/members',
  requireOrgAdmin,
  validateParams(orgIdParam),
  validateBody(addMembershipSchema),
  asyncHandler(orgsController.addMember),
);
orgsRouter.patch(
  '/:orgId/members/:userId',
  requireOrgAdmin,
  validateParams(orgIdParam.merge(userIdParam)),
  validateBody(updateMembershipSchema),
  asyncHandler(orgsController.updateMember),
);

export const campaignsRouter = Router();
campaignsRouter.use(authenticate, resolveOrgContext, requirePasswordChanged);
campaignsRouter.post('/', requireOrgAdmin, validateBody(createCampaignSchema), asyncHandler(campaignsController.create));
campaignsRouter.get('/', validateQuery(paginationQuery), asyncHandler(campaignsController.list));
campaignsRouter.get('/assignments/mine', asyncHandler(campaignsController.myAssignments));
campaignsRouter.get(
  '/assignments/:assignmentId',
  validateParams(assignmentIdParam),
  asyncHandler(campaignsController.getAssignment),
);
campaignsRouter.get(
  '/:campaignId',
  validateParams(campaignIdParam),
  asyncHandler(campaignsController.get),
);
campaignsRouter.patch(
  '/:campaignId',
  requireOrgAdmin,
  validateParams(campaignIdParam),
  validateBody(updateCampaignSchema),
  asyncHandler(campaignsController.update),
);
campaignsRouter.post(
  '/:campaignId/lifecycle',
  requireOrgAdmin,
  validateParams(campaignIdParam),
  validateBody(campaignLifecycleSchema),
  asyncHandler(campaignsController.lifecycle),
);
campaignsRouter.delete(
  '/:campaignId',
  requireOrgAdmin,
  validateParams(campaignIdParam),
  asyncHandler(campaignsController.remove),
);
campaignsRouter.post(
  '/:campaignId/members',
  requireOrgAdmin,
  validateParams(campaignIdParam),
  validateBody(campaignMembersSchema),
  asyncHandler(campaignsController.addMembers),
);
campaignsRouter.post(
  '/:campaignId/join',
  validateParams(campaignIdParam),
  asyncHandler(campaignsController.join),
);
campaignsRouter.post(
  '/:campaignId/assignments/distribute',
  requireOrgAdmin,
  validateParams(campaignIdParam),
  validateBody(distributeJuzSchema),
  asyncHandler(campaignsController.distribute),
);
campaignsRouter.post(
  '/:campaignId/assignments/manual',
  requireOrgAdmin,
  validateParams(campaignIdParam),
  validateBody(manualAssignmentsSchema),
  asyncHandler(campaignsController.manualAssign),
);
campaignsRouter.get(
  '/:campaignId/assignments/availability',
  validateParams(campaignIdParam),
  asyncHandler(campaignsController.assignmentAvailability),
);
campaignsRouter.post(
  '/:campaignId/assignments/claim',
  validateParams(campaignIdParam),
  validateBody(claimJuzSchema),
  asyncHandler(campaignsController.claimJuz),
);
campaignsRouter.get(
  '/:campaignId/assignments',
  validateParams(campaignIdParam),
  asyncHandler(campaignsController.listAssignments),
);
campaignsRouter.get(
  '/:campaignId/progress',
  validateParams(campaignIdParam),
  asyncHandler(campaignsController.progress),
);
campaignsRouter.post(
  '/assignments/:assignmentId/start',
  validateParams(assignmentIdParam),
  asyncHandler(campaignsController.startAssignment),
);
campaignsRouter.post(
  '/assignments/:assignmentId/complete',
  validateParams(assignmentIdParam),
  validateBody(completeAssignmentSchema),
  asyncHandler(campaignsController.completeAssignment),
);
campaignsRouter.post(
  '/assignments/:assignmentId/skip',
  requireOrgAdmin,
  validateParams(assignmentIdParam),
  validateBody(skipAssignmentSchema),
  asyncHandler(campaignsController.skipAssignment),
);
campaignsRouter.get(
  '/:campaignId/dhikr',
  validateParams(campaignIdParam),
  asyncHandler(campaignsController.dhikrGet),
);
campaignsRouter.post(
  '/:campaignId/dhikr/batch',
  validateParams(campaignIdParam),
  validateBody(dhikrBatchSchema),
  asyncHandler(campaignsController.dhikrBatch),
);

export function buildApiRouter(): Router {
  const api = Router();
  api.use('/auth', authRouter);
  api.use('/users', usersRouter);
  api.use('/organizations', orgsRouter);
  api.use('/campaigns', campaignsRouter);

  // Vercel Cron (and manual ops) — authorize with Bearer CRON_SECRET
  api.all(
    '/internal/cron/reconcile',
    asyncHandler(async (req, res) => {
      const { env } = await import('../config/env.js');
      const { reconcile } = await import('../cron/reconcile.js');
      const expected = env.CRON_SECRET;
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!expected || token !== expected) {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret' },
        });
        return;
      }
      await reconcile();
      sendSuccess(res, { ok: true, ranAt: new Date().toISOString() });
    }),
  );

  return api;
}
