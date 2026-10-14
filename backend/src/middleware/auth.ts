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
    let token = '';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query?.token && typeof req.query.token === 'string') {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or malformed Authorization. Expected Bearer <token> or ?token=<token>',
        },
      });
    }
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

    // Upsert user and resolve role from database (never trust client)
    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const isAdminByEmail = adminEmails.includes(authUser.email.toLowerCase());

    let userRole: 'admin' | 'user' = 'user';

    try {
      const prisma = getPrisma();
      const existingUser = await prisma.user.findUnique({ where: { id: authUser.id } }).catch(() => null);

      let initialRole: 'admin' | 'user' = 'user';
      if (isAdminByEmail) {
        initialRole = 'admin';
      } else if (!existingUser) {
        const count = await prisma.user.count().catch(() => 1);
        if (count === 0) initialRole = 'admin';
      }

      const dbUser = await prisma.user.upsert({
        where: { id: authUser.id },
        update: {
          email: authUser.email,
          name: authUser.name || undefined,
          avatar_url: authUser.avatar_url || undefined,
          ...(isAdminByEmail ? { role: 'admin' } : {}),
        },
        create: {
          id: authUser.id,
          email: authUser.email,
          name: authUser.name,
          avatar_url: authUser.avatar_url,
          role: initialRole,
        },
      });

      userRole = (dbUser as any)?.role === 'admin' ? 'admin' : 'user';
    } catch (dbErr) {
      logger.error({ dbErr, userId: authUser.id }, 'Failed to upsert user in database');
      if (isAdminByEmail) userRole = 'admin';
    }

    authUser.role = userRole;
    req.user = authUser;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Admin access required for this action',
      },
    });
  }

  next();
}
