import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import type { AuthContext, OrgRole, PlatformRole } from '../models/types.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    next(unauthorized('Missing Bearer access token'));
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    next(unauthorized('Missing Bearer access token'));
    return;
  }

  try {
    const claims = verifyAccessToken(token);
    req.auth = {
      userId: claims.sub,
      platformRole: claims.platform_role,
      orgId: claims.org_id,
      orgRole: claims.org_role,
      mustChangePassword: Boolean(claims.must_change_password),
      jti: claims.jti,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePasswordChanged(req: Request, _res: Response, next: NextFunction): void {
  if (req.auth?.mustChangePassword) {
    next(forbidden('Password change required before accessing this resource'));
    return;
  }
  next();
}

export function requirePlatformRoles(...roles: PlatformRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.auth.platformRole)) {
      next(forbidden('Insufficient platform role'));
      return;
    }
    next();
  };
}

export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(unauthorized());
    return;
  }
  if (req.auth.platformRole !== 'super_admin') {
    next(forbidden('Super admin required'));
    return;
  }
  next();
}

const ORG_ADMIN_ROLES: OrgRole[] = ['org_owner', 'org_admin'];

export function requireOrgAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(unauthorized());
    return;
  }
  if (req.auth.platformRole === 'super_admin') {
    next();
    return;
  }
  if (!req.auth.orgRole || !ORG_ADMIN_ROLES.includes(req.auth.orgRole)) {
    next(forbidden('Organization admin required'));
    return;
  }
  next();
}

export function bindOrgParam(paramName = 'orgId') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const orgId = req.params[paramName];
    if (req.auth && orgId) {
      req.auth = { ...req.auth, orgId };
    }
    next();
  };
}
