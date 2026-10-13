import { Router, Request, Response, NextFunction } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getEmailQueue } from '../queue/email.queue.js';
import { getSlackQueue } from '../queue/slack.queue.js';
import { requireAuth } from '../middleware/auth.js';

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
// Rejects unauthenticated requests; requires valid JWT token or admin bearer header
function adminAuthGuard(req: Request, res: Response, next: NextFunction) {
  // If request contains Bearer token or cookie, verify using requireAuth
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED_ADMIN',
        message: 'Authentication required to access BullMQ queue admin dashboard',
      },
    });
  }

  return requireAuth(req, res, next);
}

router.use('/queues', adminAuthGuard, serverAdapter.getRouter());

export default router;
