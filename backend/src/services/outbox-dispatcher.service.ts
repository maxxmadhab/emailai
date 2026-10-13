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
   * One-time reconciliation executed strictly ONCE on startup.
   * Recovers any outbox records that were committed to DB but not yet enqueued to Redis
   * due to a mid-request crash or queue downtime.
   * NOTE: Recurring DB polling is strictly avoided in accordance with architectural constraints.
   */
  async reconcileStartupOutbox(): Promise<number> {
    logger.info('Running one-time startup outbox reconciliation...');
    const prisma = getPrisma();

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
