import { Request, Response, NextFunction } from 'express';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { campaignService } from '../services/campaign.service.js';
import { senderService } from '../services/sender.service.js';
import { recipientParserService } from '../services/recipient-parser.service.js';
import { getPrisma } from '../lib/prisma.js';

const createCampaignSchema = z.object({
  sender_id: z.string().uuid('Invalid sender ID format'),
  name: z.string().optional(),
  subject: z.string().min(1, 'Subject is required').max(300),
  body: z.string().optional(),
  body_html: z.string().optional(),
  recipients: z.array(z.string().email()).optional(),
  delay_seconds: z.coerce.number().int().min(0).default(2),
  hourly_limit: z.coerce.number().int().positive().optional(),
  start_time: z.string().optional(),
  attachmentIds: z.array(z.string().uuid()).optional(),
});

export class CampaignController {
  /**
   * Endpoint to parse and validate CSV/TXT files before scheduling.
   * Useful for frontend previews showing valid counts, duplicates, and invalid rows.
   */
  async parseRecipients(req: Request, res: Response, next: NextFunction) {
    try {
      let content = '';

      if (req.file) {
        content = req.file.buffer.toString('utf-8');
      } else if (req.body.content) {
        content = req.body.content;
      } else {
        return res.status(400).json({
          error: {
            code: 'FILE_REQUIRED',
            message: 'A CSV/TXT file or content string is required for recipient parsing',
          },
        });
      }

      const result = recipientParserService.parseContent(content, 'auto');

      return res.status(200).json({
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Schedules a new campaign with recipients.
   * Accepts JSON body or multipart form with uploaded CSV/TXT file.
   */
  async createCampaign(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

      // 1. Resolve or auto-provision sender if sender_id is empty/missing
      let senderId = req.body.sender_id;
      if (!senderId || typeof senderId !== 'string' || senderId.trim() === '') {
        const prisma = getPrisma();
        const existingSender = await prisma.sender.findFirst({
          where: { user_id: userId },
          orderBy: { created_at: 'desc' },
        });

        if (existingSender) {
          senderId = existingSender.id;
        } else {
          // Auto-provision a verified Ethereal test account on the fly
          const testAccount = await nodemailer.createTestAccount();
          const newSender = await senderService.createSender(userId, {
            name: `Oliver Brown (${testAccount.user.split('@')[0]})`,
            email: testAccount.user,
            host: testAccount.smtp.host,
            port: testAccount.smtp.port,
            secure: testAccount.smtp.secure,
            username: testAccount.user,
            password: testAccount.pass,
            hourly_limit: 50,
          });
          senderId = newSender.id;
        }
      }

      // 2. Normalize recipients list (accepts strings or objects { email: '...' })
      let recipientsList: string[] = [];

      if (req.file) {
        const fileContent = req.file.buffer.toString('utf-8');
        const parsed = recipientParserService.parseContent(fileContent, 'auto');

        if (parsed.validRecipients.length === 0) {
          return res.status(400).json({
            error: {
              code: 'NO_VALID_RECIPIENTS',
              message: 'The uploaded file does not contain any valid email recipients',
              details: parsed.invalidRows,
            },
          });
        }
        recipientsList = parsed.validRecipients;
      } else if (Array.isArray(req.body.recipients)) {
        recipientsList = req.body.recipients
          .map((r: any) => (typeof r === 'string' ? r.trim() : r?.email?.trim()))
          .filter((e: any) => typeof e === 'string' && e.includes('@'));
      } else if (typeof req.body.recipients === 'string') {
        const parsed = recipientParserService.parseContent(req.body.recipients, 'auto');
        recipientsList = parsed.validRecipients;
      }

      const startTime = req.body.start_time || req.body.scheduled_start_at;

      let attachmentIds: string[] | undefined = undefined;
      if (Array.isArray(req.body.attachmentIds)) {
        attachmentIds = req.body.attachmentIds;
      } else if (typeof req.body.attachmentIds === 'string') {
        try {
          const parsed = JSON.parse(req.body.attachmentIds);
          if (Array.isArray(parsed)) attachmentIds = parsed;
        } catch {
          attachmentIds = req.body.attachmentIds.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
      }

      const validated = createCampaignSchema.parse({
        ...req.body,
        sender_id: senderId,
        recipients: recipientsList,
        start_time: startTime,
        attachmentIds,
      });

      const result = await campaignService.createCampaign(userId, {
        sender_id: validated.sender_id,
        name: validated.name,
        subject: validated.subject,
        body: validated.body,
        body_html: validated.body_html,
        recipients: recipientsList,
        delay_seconds: validated.delay_seconds,
        hourly_limit: validated.hourly_limit,
        start_time: validated.start_time,
        idempotency_key: idempotencyKey,
        attachmentIds: validated.attachmentIds,
      });

      return res.status(201).json({
        data: result,
        message: 'Campaign created and emails scheduled successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves single campaign details
   */
  async getCampaign(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      const campaign = await campaignService.getCampaignById(userId, id);

      if (!campaign) {
        return res.status(404).json({
          error: {
            code: 'CAMPAIGN_NOT_FOUND',
            message: 'Campaign not found',
          },
        });
      }

      return res.status(200).json({
        data: campaign,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const campaignController = new CampaignController();
