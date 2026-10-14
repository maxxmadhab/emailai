import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getPrisma } from '../lib/prisma.js';
import { removeEmailJob } from '../queue/email.queue.js';
import { elasticsearchService } from '../services/elasticsearch.service.js';
import { sseService } from '../services/sse.service.js';

const emailListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  campaign_id: z.string().uuid().optional(),
});

export class EmailController {
  /**
   * Search emails using Elasticsearch with tenant isolation and Postgres fallback.
   */
  async searchEmails(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const q = req.query.q as string | undefined;
      const status = req.query.status as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const results = await elasticsearchService.searchEmails(userId, { q, status, page, limit });
      return res.status(200).json(results);
    } catch (error) {
      next(error);
    }
  }
  /**
   * Helper to retrieve paginated emails by status for the authenticated user.
   */
  private async getEmailsByStatus(
    req: Request,
    res: Response,
    next: NextFunction,
    status: string | string[],
    orderBy: Record<string, 'asc' | 'desc'>
  ) {
    try {
      const query = emailListQuerySchema.parse(req.query);
      const userId = req.user!.id;
      const skip = (query.page - 1) * query.limit;

      const prisma = getPrisma();
      const where: any = {
        user_id: userId,
        status: Array.isArray(status) ? { in: status } : status,
        ...(query.campaign_id ? { campaign_id: query.campaign_id } : {}),
      };

      const [total, items] = await Promise.all([
        prisma.email.count({ where }),
        prisma.email.findMany({
          where,
          skip,
          take: query.limit,
          orderBy,
          include: {
            sender: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        }),
      ]);

      return res.status(200).json({
        items,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  getScheduledEmails(req: Request, res: Response, next: NextFunction) {
    // Scheduled tab includes both waiting ('scheduled') and actively dispatching ('processing')
    return this.getEmailsByStatus(req, res, next, ['scheduled', 'processing'], { scheduled_at: 'asc' });
  }

  getSentEmails(req: Request, res: Response, next: NextFunction) {
    // Sent tab includes terminal sent ('sent') and terminal failed ('failed')
    return this.getEmailsByStatus(req, res, next, ['sent', 'failed'], { sent_at: 'desc' });
  }

  getFailedEmails(req: Request, res: Response, next: NextFunction) {
    return this.getEmailsByStatus(req, res, next, 'failed', { updated_at: 'desc' });
  }

  /**
   * GET /api/emails/counts
   * Returns exact counts for scheduled (incl. processing), sent, and failed.
   */
  async getCounts(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const prisma = getPrisma();

      const [scheduled, processing, sent, failed] = await Promise.all([
        prisma.email.count({ where: { user_id: userId, status: 'scheduled' } }),
        prisma.email.count({ where: { user_id: userId, status: 'processing' } }),
        prisma.email.count({ where: { user_id: userId, status: 'sent' } }),
        prisma.email.count({ where: { user_id: userId, status: 'failed' } }),
      ]);

      return res.status(200).json({
        data: {
          scheduled: scheduled + processing,
          sent,
          failed,
          total: scheduled + processing + sent + failed,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/emails/events
   * Server-Sent Events (SSE) stream for authenticated realtime updates.
   */
  subscribeEvents(req: Request, res: Response) {
    const userId = req.user!.id;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write('data: {"type":"CONNECTED"}\n\n');

    sseService.addClient(userId, res);
  }

  /**
   * Cancels a scheduled email before it is dispatched.
   * Cancels in DB and removes the delayed job from BullMQ.
   */
  async cancelEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const prisma = getPrisma();

      // Conditional status update: can only cancel if currently 'scheduled'
      const updated = await prisma.email.updateMany({
        where: {
          id,
          user_id: userId,
          status: 'scheduled',
        },
        data: {
          status: 'cancelled',
        },
      });

      if (updated.count === 0) {
        // Check if email exists or is in another state
        const existing = await prisma.email.findFirst({
          where: { id, user_id: userId },
        });

        if (!existing) {
          return res.status(404).json({
            error: {
              code: 'EMAIL_NOT_FOUND',
              message: 'Email not found or does not belong to you',
            },
          });
        }

        return res.status(400).json({
          error: {
            code: 'CANNOT_CANCEL',
            message: `Cannot cancel email in '${existing.status}' state`,
          },
        });
      }

      // Remove from BullMQ delayed queue
      await removeEmailJob(id);

      const email = await prisma.email.findUnique({ where: { id } });

      return res.status(200).json({
        data: email,
        message: 'Email successfully cancelled',
      });
    } catch (error) {
      next(error);
    }
  }
}

export const emailController = new EmailController();
