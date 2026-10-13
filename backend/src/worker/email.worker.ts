import { Worker, Job } from 'bullmq';
import nodemailer, { Transporter } from 'nodemailer';
import { EMAIL_QUEUE_NAME, EmailJobData } from '../queue/email.queue.js';
import { getRedis } from '../lib/redis.js';
import { getPrisma } from '../lib/prisma.js';
import { getEnv } from '../config/env.js';
import { senderService } from '../services/sender.service.js';
import { logger } from '../lib/logger.js';

export class EmailWorker {
  private worker: Worker<EmailJobData> | null = null;
  // Per-sender pooled SMTP transporter cache to reuse socket connections
  private transporterPool: Map<string, Transporter> = new Map();

  /**
   * Retrieves or creates a pooled Nodemailer transporter for a sender.
   */
  private async getPooledTransporter(senderId: string): Promise<Transporter> {
    if (this.transporterPool.has(senderId)) {
      return this.transporterPool.get(senderId)!;
    }

    const creds = await senderService.getSenderCredentials(senderId);
    const transporter = nodemailer.createTransport({
      host: creds.host,
      port: creds.port,
      secure: creds.secure,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      auth: {
        user: creds.username,
        pass: creds.password,
      },
    });

    this.transporterPool.set(senderId, transporter);
    return transporter;
  }

  /**
   * Initializes and starts the BullMQ Worker.
   */
  start(): Worker<EmailJobData> {
    if (this.worker) return this.worker;

    const env = getEnv();
    const redis = getRedis();

    this.worker = new Worker<EmailJobData>(
      EMAIL_QUEUE_NAME,
      async (job: Job<EmailJobData>) => {
        return this.processEmailJob(job);
      },
      {
        connection: redis,
        concurrency: env.WORKER_CONCURRENCY,
      }
    );

    this.worker.on('completed', (job) => {
      logger.info({ jobId: job.id, emailId: job.data.emailId }, 'Job completed successfully');
    });

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, emailId: job?.data.emailId, err: err.message }, 'Job failed');
    });

    logger.info(
      { queue: EMAIL_QUEUE_NAME, concurrency: env.WORKER_CONCURRENCY },
      'Email dispatch worker started'
    );

    return this.worker;
  }

  /**
   * Core execution flow for an email job.
   */
  async processEmailJob(job: Job<EmailJobData>) {
    const { emailId, senderId, recipient } = job.data;
    const prisma = getPrisma();

    logger.info({ emailId, recipient, attempt: job.attemptsMade + 1 }, 'Worker claiming email job');

    // 1. CONDITIONAL CLAIM (DB-level idempotency)
    // Only transition if currently 'scheduled'. Loser of a race returns 0 rows.
    const claimResult = await prisma.email.updateMany({
      where: {
        id: emailId,
        status: 'scheduled',
      },
      data: {
        status: 'processing',
        attempts: { increment: 1 },
      },
    });

    if (claimResult.count === 0) {
      logger.warn(
        { emailId },
        'Email was not in scheduled state (already claimed, cancelled, or sent). Skipping job.'
      );
      return { skipped: true, reason: 'Already claimed or cancelled' };
    }

    // 2. Fetch full email row
    const email = await prisma.email.findUnique({
      where: { id: emailId },
    });

    if (!email) {
      throw new Error(`Email record ${emailId} disappeared after claim`);
    }

    // 3. [PHASE 3 PLACEHOLDER: Rate Limit & Min-Delay Admission via Redis Lua script]
    // In Phase 3, this calls redis.eval(admissionScript, senderId, ...) to enforce
    // min-delay slots and fixed UTC hourly quotas.

    // 4. AMBIGUOUS-SMTP MITIGATION STRATEGY:
    // Generate a deterministic Message-ID tied to the database email UUID.
    // If a crash happens after SMTP accept but before DB status update,
    // subsequent inspection will match this exact deterministic Message-ID.
    const deterministicMessageId = `<${emailId}@reachinbox.outbox.ai>`;

    try {
      const transporter = await this.getPooledTransporter(senderId);

      const info = await transporter.sendMail({
        from: `"${email.subject.slice(0, 15)}" <noreply@outbox.ai>`,
        to: email.recipient,
        subject: email.subject,
        text: email.body,
        html: `<p>${email.body.replace(/\n/g, '<br/>')}</p>`,
        messageId: deterministicMessageId,
      });

      const messageId = info.messageId || deterministicMessageId;
      const previewUrl = nodemailer.getTestMessageUrl(info) || null;

      // 5. ATOMIC SUCCESS STATE TRANSITION
      await prisma.email.update({
        where: { id: emailId },
        data: {
          status: 'sent',
          sent_at: new Date(),
          message_id: messageId,
          preview_url: previewUrl ? String(previewUrl) : null,
          error: null,
        },
      });

      // 6. Record Outbox Event for status update (used for Elasticsearch indexing in Phase 3)
      await prisma.outboxEvent.create({
        data: {
          event_type: 'EMAIL_STATUS_CHANGED',
          aggregate_type: 'email',
          aggregate_id: emailId,
          payload: {
            emailId,
            status: 'sent',
            sentAt: new Date().toISOString(),
            messageId,
            previewUrl,
          },
          dedupe_key: `outbox:email_status_sent:${emailId}`,
          status: 'pending',
        },
      });

      logger.info(
        { emailId, recipient, messageId, previewUrl },
        'Email successfully dispatched via SMTP'
      );

      return {
        success: true,
        emailId,
        messageId,
        previewUrl,
      };
    } catch (sendErr: any) {
      const isTransient = this.isTransientError(sendErr);

      logger.error(
        { emailId, isTransient, err: sendErr.message },
        'Error during SMTP transmission'
      );

      if (isTransient && job.attemptsMade + 1 < (job.opts.attempts || 3)) {
        // Return email to 'scheduled' state so BullMQ backoff retry can re-claim it
        await prisma.email.update({
          where: { id: emailId },
          data: {
            status: 'scheduled',
            error: `Transient error (attempt ${job.attemptsMade + 1}): ${sendErr.message}`,
          },
        });
        throw sendErr; // Re-throw to trigger BullMQ exponential backoff
      } else {
        // Permanent failure or max attempts exhausted
        await prisma.email.update({
          where: { id: emailId },
          data: {
            status: 'failed',
            error: sendErr.message || 'Permanent SMTP failure',
          },
        });

        // Publish failure outbox event
        await prisma.outboxEvent.create({
          data: {
            event_type: 'EMAIL_STATUS_CHANGED',
            aggregate_type: 'email',
            aggregate_id: emailId,
            payload: {
              emailId,
              status: 'failed',
              error: sendErr.message,
            },
            dedupe_key: `outbox:email_status_failed:${emailId}`,
            status: 'pending',
          },
        });

        return { success: false, error: sendErr.message };
      }
    }
  }

  /**
   * Distinguishes transient network errors from permanent recipient/auth rejections.
   */
  private isTransientError(error: any): boolean {
    const code = error.code || '';
    const message = error.message || '';

    // Network connection errors
    if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND'].includes(code)) {
      return true;
    }
    // SMTP 4xx temporary failure codes
    if (error.responseCode && error.responseCode >= 400 && error.responseCode < 500) {
      return true;
    }
    if (message.includes('timeout') || message.includes('Rate limit exceeded')) {
      return true;
    }

    return false;
  }

  /**
   * Graceful shutdown of worker and transporter connections.
   */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    for (const transporter of this.transporterPool.values()) {
      transporter.close();
    }
    this.transporterPool.clear();
    logger.info('Email worker closed cleanly');
  }
}

export const emailWorker = new EmailWorker();
