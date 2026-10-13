import { Queue, Job } from 'bullmq';
import { getRedis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

export const EMAIL_QUEUE_NAME = 'email-dispatch-queue';

export interface EmailJobData {
  emailId: string;
  userId: string;
  senderId: string;
  recipient: string;
  scheduledAt: string;
}

let emailQueue: Queue<EmailJobData> | null = null;

export function getEmailQueue(): Queue<EmailJobData> {
  if (!emailQueue) {
    const redis = getRedis();
    emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: false, // Retain for audit / bull-board
        removeOnFail: false,
      },
    });

    emailQueue.on('error', (err) => {
      logger.error({ err }, 'Email queue error');
    });
  }

  return emailQueue;
}

/**
 * Enqueues a delayed dispatch job with deterministic jobId = email:<emailId>.
 * If a job with the same jobId already exists in delayed/waiting state, BullMQ prevents duplicates.
 */
export async function enqueueEmailJob(
  data: EmailJobData,
  delayMs: number
): Promise<Job<EmailJobData> | null> {
  const queue = getEmailQueue();
  const deterministicJobId = `email:${data.emailId}`;

  try {
    const job = await queue.add('dispatch-email', data, {
      jobId: deterministicJobId,
      delay: Math.max(0, delayMs),
    });

    logger.info(
      { jobId: job.id, emailId: data.emailId, delayMs, recipient: data.recipient },
      'Enqueued delayed email dispatch job'
    );
    return job;
  } catch (err: any) {
    // If BullMQ duplicate job error (job with ID already exists)
    if (err.message && err.message.includes('Job already exists')) {
      logger.warn({ emailId: data.emailId }, 'Job already exists in queue, skipping duplicate enqueue');
      return null;
    }
    throw err;
  }
}

/**
 * Removes a job from the queue if cancelled before dispatch.
 */
export async function removeEmailJob(emailId: string): Promise<boolean> {
  const queue = getEmailQueue();
  const deterministicJobId = `email:${emailId}`;

  try {
    const job = await queue.getJob(deterministicJobId);
    if (job) {
      await job.remove();
      logger.info({ jobId: deterministicJobId }, 'Removed job from email queue');
      return true;
    }
    return false;
  } catch (err) {
    logger.warn({ err, emailId }, 'Failed to remove job from queue');
    return false;
  }
}
