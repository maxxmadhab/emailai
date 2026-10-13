import nodemailer from 'nodemailer';
import { getPrisma } from '../lib/prisma.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

export interface CreateSenderInput {
  name: string;
  email: string;
  host: string;
  port: number;
  secure?: boolean;
  username: string;
  password: string;
  hourly_limit?: number;
}

export class SenderService {
  /**
   * Verifies SMTP credentials using Nodemailer verify().
   */
  async verifySmtpCredentials(options: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const transporter = nodemailer.createTransport({
        host: options.host,
        port: options.port,
        secure: options.secure,
        auth: {
          user: options.user,
          pass: options.pass,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
      });

      await transporter.verify();
      return { success: true };
    } catch (err: any) {
      logger.warn({ err: err.message, host: options.host }, 'SMTP verification failed');
      return { success: false, error: err.message || 'SMTP verification failed' };
    }
  }

  /**
   * Creates a new sender account after verifying SMTP credentials and encrypting them.
   */
  async createSender(userId: string, input: CreateSenderInput) {
    const secure = input.secure ?? (input.port === 465);

    // Verify credentials with SMTP server
    const verification = await this.verifySmtpCredentials({
      host: input.host,
      port: input.port,
      secure,
      user: input.username,
      pass: input.password,
    });

    if (!verification.success) {
      const error: any = new Error(
        `Failed to verify SMTP credentials with ${input.host}:${input.port}: ${verification.error}`
      );
      error.statusCode = 400;
      error.code = 'INVALID_SMTP_CREDENTIALS';
      throw error;
    }

    // Encrypt sensitive credentials with AES-256-GCM
    const encryptedUsername = encrypt(input.username);
    const encryptedPassword = encrypt(input.password);

    const prisma = getPrisma();
    const sender = await prisma.sender.create({
      data: {
        user_id: userId,
        name: input.name,
        email: input.email,
        host: input.host,
        port: input.port,
        secure,
        encrypted_username: encryptedUsername,
        encrypted_password: encryptedPassword,
        hourly_limit: input.hourly_limit ?? 50,
        status: 'active',
      },
      select: {
        id: true,
        user_id: true,
        name: true,
        email: true,
        host: true,
        port: true,
        secure: true,
        hourly_limit: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    });

    return sender;
  }

  /**
   * Retrieves senders for a specific user with pagination.
   * Strictly tenant-scoped.
   */
  async getSendersByUser(
    userId: string,
    options: { page?: number; limit?: number } = {}
  ) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const skip = (page - 1) * limit;

    const prisma = getPrisma();

    const [total, items] = await Promise.all([
      prisma.sender.count({
        where: { user_id: userId },
      }),
      prisma.sender.findMany({
        where: { user_id: userId },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          user_id: true,
          name: true,
          email: true,
          host: true,
          port: true,
          secure: true,
          hourly_limit: true,
          status: true,
          created_at: true,
          updated_at: true,
        },
      }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves decrypted sender credentials for email worker.
   * Strictly server-side internal method.
   */
  async getSenderCredentials(senderId: string) {
    const prisma = getPrisma();
    const sender = await prisma.sender.findUnique({
      where: { id: senderId },
    });

    if (!sender) {
      throw new Error(`Sender not found: ${senderId}`);
    }

    return {
      id: sender.id,
      user_id: sender.user_id,
      name: sender.name,
      email: sender.email,
      host: sender.host,
      port: sender.port,
      secure: sender.secure,
      username: decrypt(sender.encrypted_username),
      password: decrypt(sender.encrypted_password),
      hourly_limit: sender.hourly_limit,
      status: sender.status,
    };
  }
}

export const senderService = new SenderService();
