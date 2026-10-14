import { getPrisma } from '../lib/prisma.js';
import { enqueueEmailJob, EmailJobData } from '../queue/email.queue.js';
import { logger } from '../lib/logger.js';

export class OutboxDispatcherService {
  /**
   * Dispatches a batch of outbox events directly to BullMQ.
   * Updates event status to 'published' ONLY after BullMQ enqueue confirms success.
   */
  async dispatchEvents(eventIds: string[]): Promise<number> {
    if (eventIds.length === 0) return 0;

    const prisma = getPrisma();
    const events = await prisma.outboxEvent.findMany({
      where: {
        id: { in: eventIds },
        status: 'pending',
      },
    });

    let publishedCount = 0;

    for (const event of events) {
      if (event.event_type === 'EMAIL_SCHEDULED') {
        const payload = event.payload as unknown as EmailJobData;
        const scheduledTime = new Date(payload.scheduledAt).getTime();
        const delayMs = Math.max(0, scheduledTime - Date.now());

        try {
          await enqueueEmailJob(payload, delayMs);

          // Mark published in DB
          await prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              status: 'published',
              published_at: new Date(),
            },
          });

          publishedCount++;
        } catch (err) {
          logger.error(
            { err, eventId: event.id, emailId: payload.emailId },
            'Failed to enqueue outbox event to BullMQ'
          );
        }
      }
    }

    return publishedCount;
  }

  /**
   * Recovers emails stuck in 'processing' state due to a worker crash.
   * Deterministic recovery without double-sending:
   * - If an outbox sent event exists, marks 'sent'.
   * - If attempts >= 3, marks 'failed'.
   * - Otherwise reverts to 'scheduled' and re-enqueues.
   */
  async reconcileStalledProcessingEmails(): Promise<number> {
    logger.info('Checking for stalled processing emails from prior crashes...');
    const prisma = getPrisma();

    try {
      const STALL_THRESHOLD_MS = 30 * 1000; // 30 seconds
      const thresholdDate = new Date(Date.now() - STALL_THRESHOLD_MS);

      const stuckEmails = await prisma.email.findMany({
        where: {
          status: 'processing',
          updated_at: { lt: thresholdDate },
        },
        take: 100,
      });

      if (stuckEmails.length === 0) {
        return 0;
      }

      logger.warn({ count: stuckEmails.length }, 'Found stuck processing emails to reconcile');
      let recovered = 0;

      for (const email of stuckEmails) {
        // Check if outbox has a confirmed sent event
        const sentEvent = await prisma.outboxEvent.findFirst({
          where: {
            aggregate_id: email.id,
            event_type: 'EMAIL_STATUS_CHANGED',
            dedupe_key: `outbox:email_status_sent:${email.id}`,
          },
        });

        if (sentEvent) {
          await prisma.email.update({
            where: { id: email.id },
            data: { status: 'sent' },
          });
          recovered++;
          continue;
        }

        if (email.attempts >= 3) {
          await prisma.email.update({
            where: { id: email.id },
            data: { status: 'failed', error: 'Exceeded maximum processing attempts after worker stall' },
          });
          recovered++;
          continue;
        }

        // Revert to scheduled and re-enqueue
        await prisma.email.update({
          where: { id: email.id },
          data: { status: 'scheduled' },
        });

        const delayMs = Math.max(0, new Date(email.scheduled_at).getTime() - Date.now());
        await enqueueEmailJob(
          {
            emailId: email.id,
            userId: email.user_id,
            senderId: email.sender_id,
            recipient: email.recipient,
            scheduledAt: email.scheduled_at.toISOString(),
          },
          delayMs
        );
        recovered++;
      }

      logger.info({ recovered, total: stuckEmails.length }, 'Stalled email recovery finished');
      return recovered;
    } catch (err) {
      logger.error({ err }, 'Error during stalled processing email reconciliation');
      return 0;
    }
  }

  /**
   * One-time reconciliation executed strictly ONCE on startup.
   * Recovers any outbox records that were committed to DB but not yet enqueued to Redis
   * due to a mid-request crash or queue downtime.
   * NOTE: Recurring DB polling is strictly avoided in accordance with architectural constraints.
   */
  async reconcileStartupOutbox(): Promise<number> {
    logger.info('Running one-time startup outbox reconciliation...');
    const prisma = getPrisma();

    // 1. First recover any stuck processing emails
    await this.reconcileStalledProcessingEmails();

    try {
      const pendingEvents = await prisma.outboxEvent.findMany({
        where: {
          status: 'pending',
          event_type: 'EMAIL_SCHEDULED',
        },
        take: 500, // Batch limit per startup reconciliation
        orderBy: { created_at: 'asc' },
      });

      if (pendingEvents.length === 0) {
        logger.info('Startup outbox reconciliation complete: zero pending events.');
        return 0;
      }

      logger.info(
        { count: pendingEvents.length },
        'Found pending outbox events from prior runs. Enqueueing to BullMQ...'
      );

      const eventIds = pendingEvents.map((e) => e.id);
      const published = await this.dispatchEvents(eventIds);

      logger.info({ published, total: pendingEvents.length }, 'Startup outbox reconciliation finished.');
      return published;
    } catch (err) {
      logger.error({ err }, 'Error during startup outbox reconciliation');
      return 0;
    }
  }
}

export const outboxDispatcherService = new OutboxDispatcherService();
