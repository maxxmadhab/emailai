import { randomUUID } from 'crypto';
import { getPrisma } from '../lib/prisma.js';
import { outboxDispatcherService } from './outbox-dispatcher.service.js';
import { logger } from '../lib/logger.js';

import sanitizeHtml from 'sanitize-html';

export interface CreateCampaignInput {
  sender_id: string;
  name?: string;
  subject: string;
  body?: string;
  body_html?: string;
  recipients: string[];
  delay_seconds?: number;
  hourly_limit?: number;
  start_time?: string;
  idempotency_key?: string;
  attachmentIds?: string[];
}

export function sanitizeEmailHtml(html: string): { cleanHtml: string; plainText: string } {
  const cleanHtml = sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
      'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'span', 'div',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target'],
      span: ['style'],
      p: ['style'],
      div: ['style'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
  });

  const plainText = cleanHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .trim();

  return { cleanHtml, plainText };
}

export class CampaignService {
  /**
   * Creates a campaign and schedules all emails within ONE database transaction.
   * Transactionally persists campaign, email rows, and outbox events.
   * Dispatches outbox events immediately upon commit.
   */
  async createCampaign(userId: string, input: CreateCampaignInput) {
    const prisma = getPrisma();

    // 1. Verify sender access (shared sender or owned by user)
    const sender = await prisma.sender.findFirst({
      where: {
        id: input.sender_id,
        OR: [
          { is_shared: true },
          { user_id: userId },
        ],
      },
    });

    if (!sender) {
      const err: any = new Error('Sender not found or not accessible');
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

    // 2. Validate rate limits strictly against sender caps
    const senderMinDelay = (sender as any).min_delay_seconds ?? 2;
    const requestedDelay = input.delay_seconds !== undefined ? input.delay_seconds : senderMinDelay;

    if (requestedDelay < senderMinDelay) {
      const err: any = new Error(
        `Campaign delay (${requestedDelay}s) cannot be lower than sender minimum delay (${senderMinDelay}s)`
      );
      err.statusCode = 400;
      err.code = 'DELAY_BELOW_SENDER_MINIMUM';
      throw err;
    }

    const senderHourlyLimit = sender.hourly_limit ?? 50;
    const requestedHourlyLimit = input.hourly_limit !== undefined ? input.hourly_limit : senderHourlyLimit;

    if (requestedHourlyLimit > senderHourlyLimit) {
      const err: any = new Error(
        `Campaign hourly limit (${requestedHourlyLimit}) cannot exceed sender hourly limit (${senderHourlyLimit})`
      );
      err.statusCode = 400;
      err.code = 'HOURLY_LIMIT_EXCEEDS_SENDER_CAP';
      throw err;
    }

    const delaySeconds = requestedDelay;
    const hourlyLimit = requestedHourlyLimit;

    // 3. Process and sanitize body: generate HTML and plain-text alternative
    let cleanBodyHtml: string | null = null;
    let plainBody = input.body || '';

    if (input.body_html) {
      const sanitized = sanitizeEmailHtml(input.body_html);
      cleanBodyHtml = sanitized.cleanHtml;
      if (!plainBody) {
        plainBody = sanitized.plainText;
      }
    } else if (plainBody) {
      cleanBodyHtml = `<p>${plainBody.replace(/\n/g, '<br/>')}</p>`;
    }

    // 4. Calculate scheduled time per email based on spacing
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
      body_html: string | null;
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
        body: plainBody,
        body_html: cleanBodyHtml,
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

    // 5. Execute atomic database transaction
    const { campaign, outboxEventIds } = await prisma.$transaction(async (tx) => {
      // a) Insert Campaign
      const createdCampaign = await tx.campaign.create({
        data: {
          id: campaignId,
          user_id: userId,
          sender_id: sender.id,
          name: input.name || `Campaign: ${input.subject.slice(0, 30)}`,
          subject: input.subject,
          body: plainBody,
          body_html: cleanBodyHtml,
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

      // c) Link Attachments if provided
      if (input.attachmentIds && input.attachmentIds.length > 0) {
        await tx.attachment.updateMany({
          where: {
            id: { in: input.attachmentIds },
            user_id: userId,
          },
          data: {
            campaign_id: campaignId,
          },
        });
      }

      // d) Insert Outbox Events
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
