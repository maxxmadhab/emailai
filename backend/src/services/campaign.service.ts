import { randomUUID } from 'crypto';
import { getPrisma } from '../lib/prisma.js';
import { outboxDispatcherService } from './outbox-dispatcher.service.js';
import { logger } from '../lib/logger.js';

export interface CreateCampaignInput {
  sender_id: string;
  name?: string;
  subject: string;
  body: string;
  recipients: string[];
  delay_seconds?: number;
  hourly_limit?: number;
  start_time?: string;
  idempotency_key?: string;
}

export class CampaignService {
  /**
   * Creates a campaign and schedules all emails within ONE database transaction.
   * Transactionally persists campaign, email rows, and outbox events.
   * Dispatches outbox events immediately upon commit.
   */
  async createCampaign(userId: string, input: CreateCampaignInput) {
    const prisma = getPrisma();

    // 1. Verify sender ownership
    const sender = await prisma.sender.findFirst({
      where: {
        id: input.sender_id,
        user_id: userId,
      },
    });

    if (!sender) {
      const err: any = new Error('Sender not found or does not belong to the authenticated user');
      err.statusCode = 404;
      err.code = 'SENDER_NOT_FOUND';
      throw err;
    }

    if (input.recipients.length === 0) {
      const err: any = new Error('At least one valid recipient is required');
      err.statusCode = 400;
      err.code = 'EMPTY_RECIPIENTS';
      throw err;
    }

    // 2. Validate and clamp rate limits
    const delaySeconds = Math.max(0, input.delay_seconds ?? 2);
    // Campaign limit cannot exceed sender's limit
    const hourlyLimit = input.hourly_limit
      ? Math.min(input.hourly_limit, sender.hourly_limit)
      : sender.hourly_limit;

    // 3. Calculate scheduled time per email based on spacing
    const baseStartTime = input.start_time ? new Date(input.start_time).getTime() : Date.now();
    const now = Date.now();
    const effectiveStartTime = Math.max(now, isNaN(baseStartTime) ? now : baseStartTime);

    const campaignId = randomUUID();
    const emailsData: Array<{
      id: string;
      campaign_id: string;
      user_id: string;
      sender_id: string;
      recipient: string;
      subject: string;
      body: string;
      status: string;
      scheduled_at: Date;
    }> = [];

    const outboxEventsData: Array<{
      id: string;
      event_type: string;
      aggregate_type: string;
      aggregate_id: string;
      payload: any;
      dedupe_key: string;
      status: string;
    }> = [];

    for (let i = 0; i < input.recipients.length; i++) {
      const emailId = randomUUID();
      const scheduledTime = new Date(effectiveStartTime + i * delaySeconds * 1000);
      const recipient = input.recipients[i];

      emailsData.push({
        id: emailId,
        campaign_id: campaignId,
        user_id: userId,
        sender_id: sender.id,
        recipient,
        subject: input.subject,
        body: input.body,
        status: 'scheduled',
        scheduled_at: scheduledTime,
      });

      outboxEventsData.push({
        id: randomUUID(),
        event_type: 'EMAIL_SCHEDULED',
        aggregate_type: 'email',
        aggregate_id: emailId,
        payload: {
          emailId,
          userId,
          senderId: sender.id,
          recipient,
          scheduledAt: scheduledTime.toISOString(),
        },
        dedupe_key: `outbox:email_scheduled:${emailId}`,
        status: 'pending',
      });
    }

    // 4. Execute atomic database transaction
    const { campaign, outboxEventIds } = await prisma.$transaction(async (tx) => {
      // a) Insert Campaign
      const createdCampaign = await tx.campaign.create({
        data: {
          id: campaignId,
          user_id: userId,
          sender_id: sender.id,
          name: input.name || `Campaign: ${input.subject.slice(0, 30)}`,
          subject: input.subject,
          body: input.body,
          delay_seconds: delaySeconds,
          hourly_limit: hourlyLimit,
          idempotency_key: input.idempotency_key || null,
          status: 'active',
        },
      });

      // b) Insert Emails
      await tx.email.createMany({
        data: emailsData,
      });

      // c) Insert Outbox Events
      await tx.outboxEvent.createMany({
        data: outboxEventsData,
      });

      return {
        campaign: createdCampaign,
        outboxEventIds: outboxEventsData.map((e) => e.id),
      };
    });

    // 5. Asynchronously dispatch outbox events to BullMQ
    outboxDispatcherService.dispatchEvents(outboxEventIds).catch((err) => {
      logger.error({ err, campaignId }, 'Background outbox dispatch encountered error');
    });

    return {
      campaign,
      totalScheduled: emailsData.length,
      scheduledStart: emailsData[0]?.scheduled_at.toISOString(),
      scheduledEnd: emailsData[emailsData.length - 1]?.scheduled_at.toISOString(),
    };
  }

  /**
   * Retrieves tenant-scoped campaign details
   */
  async getCampaignById(userId: string, campaignId: string) {
    const prisma = getPrisma();
    return prisma.campaign.findFirst({
      where: {
        id: campaignId,
        user_id: userId,
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
            hourly_limit: true,
          },
        },
      },
    });
  }
}

export const campaignService = new CampaignService();
