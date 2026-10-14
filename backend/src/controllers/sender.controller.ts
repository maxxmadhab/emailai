import { Request, Response, NextFunction } from 'express';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { senderService } from '../services/sender.service.js';

const createSenderSchema = z.object({
  name: z.string().min(1, 'Sender name is required').max(100),
  email: z.string().email('Valid email address is required'),
  host: z.string().min(1, 'SMTP host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  secure: z.boolean().optional(),
  username: z.string().min(1, 'SMTP username is required'),
  password: z.string().min(1, 'SMTP password is required'),
  hourly_limit: z.coerce.number().int().min(1).max(5000).default(50),
  min_delay_seconds: z.coerce.number().int().min(0).max(3600).default(2),
  is_shared: z.boolean().default(true),
});

const updateSenderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  host: z.string().min(1).optional(),
  port: z.coerce.number().int().positive().optional(),
  secure: z.boolean().optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  hourly_limit: z.coerce.number().int().min(1).max(5000).optional(),
  min_delay_seconds: z.coerce.number().int().min(0).max(3600).optional(),
  is_shared: z.boolean().optional(),
});

const getSendersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export class SenderController {
  async createSender(req: Request, res: Response, next: NextFunction) {
    try {
      const validatedInput = createSenderSchema.parse(req.body);
      const userId = req.user!.id;

      const sender = await senderService.createSender(userId, validatedInput);

      return res.status(201).json({
        data: sender,
        message: 'Sender account created and verified successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async createEtherealSender(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const testAccount = await nodemailer.createTestAccount();
      const sender = await senderService.createSender(userId, {
        name: `Shared Outbox (${testAccount.user.split('@')[0]})`,
        email: testAccount.user,
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        username: testAccount.user,
        password: testAccount.pass,
        hourly_limit: 50,
        min_delay_seconds: 2,
        is_shared: true,
      });

      return res.status(201).json({
        data: sender,
        message: 'Ethereal sender created and verified successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async updateSender(req: Request, res: Response, next: NextFunction) {
    try {
      const senderId = req.params.id;
      const validatedInput = updateSenderSchema.parse(req.body);

      const updated = await senderService.updateSender(senderId, validatedInput);

      return res.status(200).json({
        data: updated,
        message: 'Sender updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteSender(req: Request, res: Response, next: NextFunction) {
    try {
      const senderId = req.params.id;
      await senderService.deleteSender(senderId);

      return res.status(200).json({
        data: { id: senderId },
        message: 'Sender deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async getSenders(req: Request, res: Response, next: NextFunction) {
    try {
      const query = getSendersQuerySchema.parse(req.query);
      const user = req.user!;

      const result = await senderService.getSendersByUser(user, query);

      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getSenderById(req: Request, res: Response, next: NextFunction) {
    try {
      const senderId = req.params.id;
      const user = req.user!;
      const result = await senderService.getSendersByUser(user, { limit: 100 });
      const found = result.items.find((s: any) => s.id === senderId);

      if (!found) {
        return res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Sender not found or not accessible',
          },
        });
      }

      return res.status(200).json({ data: found });
    } catch (error) {
      next(error);
    }
  }
}

export const senderController = new SenderController();
