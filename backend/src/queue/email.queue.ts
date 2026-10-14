import { Queue, Job } from 'bullmq';
import { createRedisClient } from '../lib/redis.js';
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
    const redis = createRedisClient();
    emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: { count: 1000 }, // Retain latest 1000 for audit / bull-board without permanent collision
        removeOnFail: { count: 1000 },
      },
    });

    emailQueue.on('error', (err) => {
      logger.error({ err }, 'Email queue error');
    });
  }

  return emailQueue;
}

/**
 * Enqueues a delayed dispatch job with deterministic jobId = email_<emailId>.
 * If a job is being rescheduled or if a collision occurs, a timestamp suffix is appended.
 */
export async function enqueueEmailJob(
  data: EmailJobData,
  delayMs: number,
  options?: { isReschedule?: boolean }
): Promise<Job<EmailJobData> | null> {
  const queue = getEmailQueue();
  const deterministicJobId = options?.isReschedule
    ? `email_${data.emailId}_${Date.now()}`
    : `email_${data.emailId}`;

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
      try {
        const fallbackJob = await queue.add('dispatch-email', data, {
          jobId: `email_${data.emailId}_${Date.now()}`,
          delay: Math.max(0, delayMs),
        });
        logger.info(
          { jobId: fallbackJob.id, emailId: data.emailId, delayMs },
          'Enqueued email dispatch job with unique fallback ID after collision'
        );
        return fallbackJob;
      } catch (fallbackErr) {
        logger.warn({ emailId: data.emailId }, 'Job already exists in queue, skipping duplicate enqueue');
        return null;
      }
    }
    throw err;
  }
}

/**
 * Removes a job from the queue if cancelled before dispatch.
 */
export async function removeEmailJob(emailId: string): Promise<boolean> {
  const queue = getEmailQueue();
  const deterministicJobId = `email_${emailId}`;

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
