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
  min_delay_seconds?: number;
  is_shared?: boolean;
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
        min_delay_seconds: input.min_delay_seconds ?? 2,
        is_shared: input.is_shared ?? true,
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
        min_delay_seconds: true,
        is_shared: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    });

    return sender;
  }

  /**
   * Updates an existing sender configuration (admin only).
   */
  async updateSender(senderId: string, input: Partial<CreateSenderInput>) {
    const prisma = getPrisma();
    const existing = await prisma.sender.findUnique({ where: { id: senderId } });
    if (!existing) {
      const err: any = new Error(`Sender not found: ${senderId}`);
      err.statusCode = 404;
      err.code = 'SENDER_NOT_FOUND';
      throw err;
    }

    const data: any = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) data.email = input.email;
    if (input.host !== undefined) data.host = input.host;
    if (input.port !== undefined) data.port = input.port;
    if (input.secure !== undefined) data.secure = input.secure;
    if (input.hourly_limit !== undefined) data.hourly_limit = input.hourly_limit;
    if (input.min_delay_seconds !== undefined) data.min_delay_seconds = input.min_delay_seconds;
    if (input.is_shared !== undefined) data.is_shared = input.is_shared;

    if (input.username) data.encrypted_username = encrypt(input.username);
    if (input.password) data.encrypted_password = encrypt(input.password);

    const updated = await prisma.sender.update({
      where: { id: senderId },
      data,
      select: {
        id: true,
        user_id: true,
        name: true,
        email: true,
        host: true,
        port: true,
        secure: true,
        hourly_limit: true,
        min_delay_seconds: true,
        is_shared: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    });

    return updated;
  }

  /**
   * Deletes a sender (admin only).
   */
  async deleteSender(senderId: string) {
    const prisma = getPrisma();
    await prisma.sender.delete({
      where: { id: senderId },
    });
    return { deleted: true };
  }

  /**
   * Retrieves senders for users or admins.
   * Admin receives full admin shape; regular users receive safe public shape without credentials.
   */
  async getSendersByUser(
    user: { id: string; role?: string },
    options: { page?: number; limit?: number } = {}
  ) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const skip = (page - 1) * limit;

    const prisma = getPrisma();
    const isAdmin = user.role === 'admin';

    const whereClause: any = isAdmin
      ? {}
      : {
          OR: [
            { is_shared: true },
            { user_id: user.id },
          ],
        };

    const [total, items] = await Promise.all([
      prisma.sender.count({ where: whereClause }),
      prisma.sender.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
    ]);

    const formatted = items.map((s: any) => {
      if (isAdmin) {
        return {
          id: s.id,
          user_id: s.user_id,
          name: s.name,
          email: s.email,
          host: s.host || s.smtp_host,
          smtp_host: s.smtp_host || s.host,
          port: s.port || s.smtp_port,
          smtp_port: s.smtp_port || s.port,
          secure: s.secure,
          hourly_limit: s.hourly_limit,
          min_delay_seconds: s.min_delay_seconds ?? 2,
          is_shared: s.is_shared ?? true,
          status: s.status,
          created_at: s.created_at,
          updated_at: s.updated_at,
        };
      }

      // Safe public shape: never leaks host, port, username, password, or encrypted secrets
      return {
        id: s.id,
        name: s.name,
        email: s.email,
        hourly_limit: s.hourly_limit,
        min_delay_seconds: s.min_delay_seconds ?? 2,
        status: s.status,
      };
    });

    return {
      items: formatted,
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
