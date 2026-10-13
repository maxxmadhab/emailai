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
});

const getSendersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
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
        name: `Oliver Brown (${testAccount.user.split('@')[0]})`,
        email: testAccount.user,
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        username: testAccount.user,
        password: testAccount.pass,
        hourly_limit: 50,
      });

      return res.status(201).json({
        data: sender,
        message: 'Ethereal sender created and verified successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async getSenders(req: Request, res: Response, next: NextFunction) {
    try {
      const query = getSendersQuerySchema.parse(req.query);
      const userId = req.user!.id;

      const result = await senderService.getSendersByUser(userId, query);

      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const senderController = new SenderController();
