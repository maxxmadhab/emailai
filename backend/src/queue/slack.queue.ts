import { Queue, Worker, Job } from 'bullmq';
import { getRedis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { slackService } from '../services/slack.service.js';

export const SLACK_QUEUE_NAME = 'slack-notification-queue';

export interface SlackAlertData {
  userId: string;
  senderId: string;
  senderEmail: string;
  hourlyLimit: number;
  currentCount: number;
  windowStart: string;
  windowEnd: string;
  queuedCount?: number;
}

let slackQueue: Queue<SlackAlertData> | null = null;
let slackWorker: Worker<SlackAlertData> | null = null;

export function getSlackQueue(): Queue<SlackAlertData> {
  if (!slackQueue) {
    const redis = getRedis();
    slackQueue = new Queue<SlackAlertData>(SLACK_QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 3000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  }
  return slackQueue;
}

export function startSlackWorker(): Worker<SlackAlertData> {
  if (!slackWorker) {
    const redis = getRedis();
    slackWorker = new Worker<SlackAlertData>(
      SLACK_QUEUE_NAME,
      async (job: Job<SlackAlertData>) => {
        logger.info({ jobId: job.id, senderId: job.data.senderId }, 'Processing Slack alert job');
        await slackService.sendRateLimitAlert(job.data);
      },
      {
        connection: redis,
        concurrency: 2,
      }
    );

    slackWorker.on('completed', (job) => {
      logger.info({ jobId: job.id }, 'Slack alert sent successfully');
    });

    slackWorker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, err: err.message }, 'Slack alert failed');
    });
  }
  return slackWorker;
}

export async function enqueueSlackAlert(data: SlackAlertData): Promise<void> {
  const queue = getSlackQueue();
  // Deterministic job ID ensures at most one notification job per sender per window
  const jobId = `slack_alert:${data.senderId}:${data.windowStart}`;

  try {
    await queue.add('send-slack-alert', data, {
      jobId,
    });
    logger.info({ jobId, senderId: data.senderId }, 'Enqueued Slack rate limit alert');
  } catch (err: any) {
    if (err.message && err.message.includes('Job already exists')) {
      logger.info({ jobId }, 'Slack alert already queued for this window');
      return;
    }
    throw err;
  }
}
