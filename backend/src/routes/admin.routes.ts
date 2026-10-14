import { Router, Request, Response, NextFunction } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getEmailQueue } from '../queue/email.queue.js';
import { getSlackQueue } from '../queue/slack.queue.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getPrisma } from '../lib/prisma.js';
import { z } from 'zod';

const router = Router();

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(getEmailQueue()),
    new BullMQAdapter(getSlackQueue()),
  ],
  serverAdapter,
});

// Admin authentication middleware:
// Rejects unauthenticated requests with 401; rejects non-admins with 403
// Static UI assets (.js, .css, images, fonts) are served without blocking so the SPA can load.
function adminAuthGuard(req: Request, res: Response, next: NextFunction) {
  // Allow all static dashboard assets (.js, .css, images, fonts) without blocking
  if (
    req.path.includes('/static') ||
    req.originalUrl.includes('/static') ||
    /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i.test(req.path)
  ) {
    return next();
  }

  let token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token && typeof req.query.token === 'string') {
    token = req.query.token;
  }
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)admin_token=([^;]+)/);
    if (match) token = decodeURIComponent(match[1]);
  }
  if (!token && req.headers.referer) {
    try {
      const url = new URL(req.headers.referer);
      token = url.searchParams.get('token') || undefined;
    } catch {}
  }

  if (!token) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED_ADMIN',
        message: 'Authentication required to access BullMQ queue admin dashboard. Append ?token=<admin_jwt> to the URL.',
      },
    });
  }

  // Set cookie for subsequent internal SPA fetch calls if token came from query
  if (req.query.token && typeof req.query.token === 'string') {
    res.cookie('admin_token', req.query.token, {
      path: '/admin',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  req.headers.authorization = `Bearer ${token}`;
  return requireAuth(req, res, () => {
    return requireAdmin(req, res, next);
  });
}

router.use('/queues', adminAuthGuard, serverAdapter.getRouter());

// Admin User Role Management: List users
router.get('/users', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar_url: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
    return res.json({ data: users });
  } catch (err) {
    next(err);
  }
});

const updateRoleSchema = z.object({
  role: z.enum(['admin', 'user']),
});

// Admin User Role Management: Promote / Demote user
router.patch('/users/:id/role', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { role } = updateRoleSchema.parse(req.body);
    const userId = req.params.id;
    const prisma = getPrisma();

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    return res.json({
      data: updated,
      message: `User role updated to ${role} successfully`,
    });
  } catch (err) {
    next(err);
  }
});

// Admin overview settings
router.get('/settings', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const [userCount, senderCount, campaignCount] = await Promise.all([
      prisma.user.count(),
      prisma.sender.count(),
      prisma.campaign.count(),
    ]);
    return res.json({
      data: {
        totalUsers: userCount,
        totalSenders: senderCount,
        totalCampaigns: campaignCount,
        adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
