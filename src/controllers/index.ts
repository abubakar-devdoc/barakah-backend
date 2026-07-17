import type { Request, Response } from 'express';
import { authService, userAdminService } from '../services/auth.service.js';
import {
  campaignService,
  dhikrService,
  organizationService,
} from '../services/campaign.service.js';
import { sendCreated, sendSuccess } from '../utils/response.js';
import { env } from '../config/env.js';
import { unauthorized } from '../utils/errors.js';

export const authController = {
  login: async (req: Request, res: Response) => {
    const data = await authService.login({
      ...req.body,
      userAgent: req.header('user-agent') ?? undefined,
      ip: req.ip,
      res,
    });
    sendSuccess(res, data);
  },
  refresh: async (req: Request, res: Response) => {
    const token =
      req.cookies?.[env.REFRESH_COOKIE_NAME] ??
      (req.body?.refreshToken as string | undefined);
    const data = await authService.refresh({
      refreshToken: token,
      userAgent: req.header('user-agent') ?? undefined,
      ip: req.ip,
      res,
    });
    sendSuccess(res, data);
  },
  logout: async (req: Request, res: Response) => {
    const token =
      req.cookies?.[env.REFRESH_COOKIE_NAME] ??
      (req.body?.refreshToken as string | undefined);
    await authService.logout({ refreshToken: token, res, auth: req.auth });
    sendSuccess(res, { loggedOut: true });
  },
  changePassword: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await authService.changePassword({
      auth: req.auth,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
      res,
    });
    sendSuccess(res, data);
  },
  me: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await authService.me(req.auth);
    sendSuccess(res, data);
  },
};

export const usersController = {
  create: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await userAdminService.create({ auth: req.auth, ...req.body });
    sendCreated(res, data);
  },
  list: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const data = await userAdminService.list(req.auth, page, limit);
    sendSuccess(res, data);
  },
  get: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await userAdminService.get(req.auth, req.params.userId!);
    sendSuccess(res, data);
  },
  update: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await userAdminService.update(req.auth, req.params.userId!, req.body);
    sendSuccess(res, data);
  },
  remove: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await userAdminService.remove(req.auth, req.params.userId!);
    sendSuccess(res, data);
  },
};

export const orgsController = {
  create: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await organizationService.create(req.auth, {
      name: req.body.name,
      slug: req.body.slug,
      orgType: req.body.orgType,
      settings: req.body.settings,
    });
    sendCreated(res, data);
  },
  list: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await organizationService.listMine(req.auth);
    sendSuccess(res, data);
  },
  get: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await organizationService.get(req.auth, req.params.orgId!);
    sendSuccess(res, data);
  },
  addMember: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await organizationService.addMember(req.auth, req.params.orgId!, req.body);
    sendCreated(res, data);
  },
  updateMember: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await organizationService.updateMember(
      req.auth,
      req.params.orgId!,
      req.params.userId!,
      req.body,
    );
    sendSuccess(res, data);
  },
};

export const campaignsController = {
  create: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.create(req.auth, req.body);
    sendCreated(res, data);
  },
  list: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.list(req.auth, {
      organizationId: req.query.organizationId as string | undefined,
      status: req.query.status as string | undefined,
      page: Number(req.query.page ?? 1),
      limit: Number(req.query.limit ?? 20),
    });
    sendSuccess(res, data);
  },
  get: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.get(req.auth, req.params.campaignId!);
    sendSuccess(res, data);
  },
  update: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.update(req.auth, req.params.campaignId!, req.body);
    sendSuccess(res, data);
  },
  lifecycle: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.setLifecycle(
      req.auth,
      req.params.campaignId!,
      req.body.status,
      req.body.version,
    );
    sendSuccess(res, data);
  },
  remove: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.softDelete(req.auth, req.params.campaignId!);
    sendSuccess(res, data);
  },
  addMembers: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.addMembers(
      req.auth,
      req.params.campaignId!,
      req.body.userIds,
      req.body.role,
    );
    sendSuccess(res, data);
  },
  join: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.join(req.auth, req.params.campaignId!);
    sendSuccess(res, data);
  },
  distribute: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    if (req.body.persist === false) {
      const data = await campaignService.suggestDistribution(
        req.auth,
        req.params.campaignId!,
        req.body.userIds,
        req.body.juzNumbers,
      );
      sendSuccess(res, data);
      return;
    }
    const data = await campaignService.distributeAndPersist(
      req.auth,
      req.params.campaignId!,
      req.body.userIds,
      req.body.juzNumbers,
    );
    sendSuccess(res, data);
  },
  manualAssign: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.manualAssign(req.auth, req.params.campaignId!, req.body);
    sendSuccess(res, data);
  },
  assignmentAvailability: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.assignmentAvailability(req.auth, req.params.campaignId!);
    sendSuccess(res, data);
  },
  claimJuz: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.claimJuz(
      req.auth,
      req.params.campaignId!,
      req.body.juzNumber,
    );
    sendCreated(res, data);
  },
  listAssignments: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.listAssignments(req.auth, req.params.campaignId!);
    sendSuccess(res, data);
  },
  myAssignments: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.myAssignments(
      req.auth,
      req.query.campaignId as string | undefined,
    );
    sendSuccess(res, data);
  },
  getAssignment: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.getAssignment(req.auth, req.params.assignmentId!);
    sendSuccess(res, data);
  },
  startAssignment: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.startAssignment(req.auth, req.params.assignmentId!);
    sendSuccess(res, data);
  },
  completeAssignment: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.completeAssignment(
      req.auth,
      req.params.assignmentId!,
      req.body,
    );
    sendSuccess(res, data);
  },
  skipAssignment: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.skipAssignment(
      req.auth,
      req.params.assignmentId!,
      req.body,
    );
    sendSuccess(res, data);
  },
  progress: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await campaignService.progress(req.auth, req.params.campaignId!);
    sendSuccess(res, data);
  },
  dhikrGet: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await dhikrService.getCampaignData(req.auth, req.params.campaignId!);
    sendSuccess(res, data);
  },
  dhikrBatch: async (req: Request, res: Response) => {
    if (!req.auth) throw unauthorized();
    const data = await dhikrService.submitBatch(req.auth, req.params.campaignId!, req.body);
    sendSuccess(res, data);
  },
};
