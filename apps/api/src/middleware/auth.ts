import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@payment-recon/shared';
import { env } from '../config/env';

export const SESSION_COOKIE = 'session';

export type AuthUser = { id: string; role: Role; merchantId: string };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Reads the httpOnly session cookie, verifies the JWT, and sets req.user. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string') {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub: string; role: Role; merchantId: string };
    req.user = { id: payload.sub, role: payload.role, merchantId: payload.merchantId };
    next();
  } catch {
    res.status(401).json({ error: 'Session expired or invalid' });
  }
}

/** Use after requireAuth. Rejects users whose role is not in the list. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
