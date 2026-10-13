import { Request, Response, NextFunction } from 'express';
import { verifySupabaseToken, AuthUser } from '../lib/jwt.js';
import { getPrisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or malformed Authorization header. Expected Bearer <token>',
        },
      });
    }

    const token = authHeader.split(' ')[1];
    let authUser: AuthUser;

    try {
      authUser = verifySupabaseToken(token);
    } catch (err: any) {
      const isExpired = err?.name === 'TokenExpiredError';
      return res.status(401).json({
        error: {
          code: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
          message: isExpired ? 'Token has expired' : (err?.message || 'Invalid authentication token'),
        },
      });
    }

    // Upsert user on first authenticated request
    try {
      const prisma = getPrisma();
      await prisma.user.upsert({
        where: { id: authUser.id },
        update: {
          email: authUser.email,
          name: authUser.name || undefined,
          avatar_url: authUser.avatar_url || undefined,
        },
        create: {
          id: authUser.id,
          email: authUser.email,
          name: authUser.name,
          avatar_url: authUser.avatar_url,
        },
      });
    } catch (dbErr) {
      // In tests or if DB is offline, log error; if testing without DB mock, proceed or handle
      logger.error({ dbErr, userId: authUser.id }, 'Failed to upsert user in database');
    }

    req.user = authUser;
    next();
  } catch (error) {
    next(error);
  }
}
