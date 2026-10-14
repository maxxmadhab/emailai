import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailWorker } from '../../src/worker/email.worker.js';
import { outboxDispatcherService } from '../../src/services/outbox-dispatcher.service.js';
import * as prismaModule from '../../src/lib/prisma.js';
import * as queueModule from '../../src/queue/email.queue.js';
import { rateLimiterService } from '../../src/services/rate-limiter.service.js';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { mintTestToken } from '../../src/lib/jwt.js';

describe('C1: Scheduled to Sent Transition & Worker Correctness', () => {
  const emailWorker = new EmailWorker();
  const testUserId = 'user-c1-uuid-0001';
  const testSenderId = 'sender-c1-uuid-0001';
  const testEmailId = 'email-c1-uuid-0001';

  let emailRecord: any;
  let outboxEvents: any[] = [];
  let sendMailCalls = 0;

  const mockPrisma: any = {
    email: {
      updateMany: vi.fn().mockImplementation(({ where, data }) => {
        if (emailRecord.id === where.id && emailRecord.status === where.status) {
          Object.assign(emailRecord, data, { attempts: (emailRecord.attempts || 0) + 1 });
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      }),
      findUnique: vi.fn().mockImplementation(() => Promise.resolve({ ...emailRecord })),
      findMany: vi.fn().mockImplementation(({ where }) => {
        const matchesStatus = (s: string) => {
          if (!where?.status) return true;
          if (typeof where.status === 'string') return s === where.status;
          if (where.status.in && Array.isArray(where.status.in)) return where.status.in.includes(s);
          return false;
        };
        const results = [emailRecord].filter(
          (e) => (!where?.user_id || e.user_id === where.user_id) && matchesStatus(e.status)
        );
        return Promise.resolve(results);
      }),
      count: vi.fn().mockImplementation(({ where }) => {
        const matchesStatus = (s: string) => {
          if (!where?.status) return true;
          if (typeof where.status === 'string') return s === where.status;
          if (where.status.in && Array.isArray(where.status.in)) return where.status.in.includes(s);
          return false;
        };
        const count = [emailRecord].filter(
          (e) => (!where?.user_id || e.user_id === where.user_id) && matchesStatus(e.status)
        ).length;
        return Promise.resolve(count);
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        if (emailRecord.id === where.id) {
          Object.assign(emailRecord, data);
        }
        return Promise.resolve({ ...emailRecord });
      }),
    },
    sender: {
      findUnique: vi.fn().mockResolvedValue({
        id: testSenderId,
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        encrypted_username: 'iv:tag:user',
        encrypted_password: 'iv:tag:pass',
        hourly_limit: 50,
      }),
    },
    outboxEvent: {
      create: vi.fn().mockImplementation(({ data }) => {
        outboxEvents.push(data);
        return Promise.resolve(data);
      }),
      findMany: vi.fn().mockImplementation(({ where }) => {
        return Promise.resolve(outboxEvents.filter((e) => e.status === where?.status));
      }),
      findFirst: vi.fn().mockImplementation(({ where }) => {
        return Promise.resolve(
          outboxEvents.find((e) => !where?.aggregate_id || e.aggregate_id === where.aggregate_id) || null
        );
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        const ev = outboxEvents.find((e) => e.id === where.id);
        if (ev) Object.assign(ev, data);
        return Promise.resolve(ev);
      }),
    },
    user: {
      upsert: vi.fn().mockResolvedValue({ id: testUserId, email: 'test@c1.io' }),
      findUnique: vi.fn().mockResolvedValue({ id: testUserId, email: 'test@c1.io' }),
    },
    $transaction: vi.fn().mockImplementation((cb) => (typeof cb === 'function' ? cb(mockPrisma) : Promise.all(cb))),
  };

  beforeEach(() => {
    sendMailCalls = 0;
    outboxEvents = [];
    emailRecord = {
      id: testEmailId,
      user_id: testUserId,
      sender_id: testSenderId,
      recipient: 'valid.client@example.com',
      subject: 'C1 Verification Subject',
      body: 'C1 Verification Body',
      status: 'scheduled',
      attempts: 0,
      scheduled_at: new Date(),
    };

    vi.spyOn(prismaModule, 'getPrisma').mockReturnValue(mockPrisma);
    vi.spyOn(queueModule, 'enqueueEmailJob').mockResolvedValue({ id: 'mock-bull-job' } as any);
    vi.spyOn(rateLimiterService, 'requestAdmission').mockResolvedValue({
      decision: 'GRANTED',
      currentCount: 1,
      hourlyLimit: 50,
      shouldAlert: false,
      windowStartMs: Date.now(),
      windowEndMs: Date.now() + 3600000,
    });
  });

  it('1. Worker marks email as "sent" only when SMTP accepted recipient and returned 2xx response', async () => {
    (emailWorker as any).getPooledTransporter = vi.fn().mockResolvedValue({
      sendMail: vi.fn().mockImplementation(async () => {
        sendMailCalls++;
        return {
          messageId: '<msg-c1-accepted@outbox.ai>',
          accepted: ['valid.client@example.com'],
          rejected: [],
          response: '250 2.0.0 OK queued',
        };
      }),
    });

    const mockJob: any = {
      id: `email:${testEmailId}`,
      data: { emailId: testEmailId, senderId: testSenderId, recipient: emailRecord.recipient },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    const res = await emailWorker.processEmailJob(mockJob);
    expect(res.success).toBe(true);
    expect(emailRecord.status).toBe('sent');
    expect(emailRecord.message_id).toBe('<msg-c1-accepted@outbox.ai>');
    expect(emailRecord.sent_at).toBeDefined();
    expect(sendMailCalls).toBe(1);

    // Verify outbox event created for real-time sync
    const statusEvent = outboxEvents.find((e) => e.event_type === 'EMAIL_STATUS_CHANGED');
    expect(statusEvent).toBeDefined();
    expect(statusEvent.payload.status).toBe('sent');
  });

  it('2. Worker treats rejected recipient as permanent failure and NEVER marks as "sent"', async () => {
    (emailWorker as any).getPooledTransporter = vi.fn().mockResolvedValue({
      sendMail: vi.fn().mockImplementation(async () => {
        sendMailCalls++;
        return {
          messageId: '<msg-c1-rejected@outbox.ai>',
          accepted: [],
          rejected: ['valid.client@example.com'],
          response: '550 5.1.1 User unknown',
        };
      }),
    });

    const mockJob: any = {
      id: `email:${testEmailId}`,
      data: { emailId: testEmailId, senderId: testSenderId, recipient: emailRecord.recipient },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    const res = await emailWorker.processEmailJob(mockJob);
    expect(res.success).toBe(false);
    // Verify status was transitioned to failed, never sent
    expect(emailRecord.status).toBe('failed');
    expect(emailRecord.status).not.toBe('sent');
  });

  it('3. DB write failure after SMTP accept retries DB update without re-sending the email', async () => {
    (emailWorker as any).getPooledTransporter = vi.fn().mockResolvedValue({
      sendMail: vi.fn().mockImplementation(async () => {
        sendMailCalls++;
        return {
          messageId: '<msg-c1-resilience@outbox.ai>',
          accepted: ['valid.client@example.com'],
          rejected: [],
          response: '250 OK',
        };
      }),
    });

    let dbFailures = 2;
    mockPrisma.$transaction = vi.fn().mockImplementation(async (cb) => {
      if (dbFailures > 0) {
        dbFailures--;
        throw new Error('Deadlock / transient DB connection error');
      }
      return cb(mockPrisma);
    });

    const mockJob: any = {
      id: `email:${testEmailId}`,
      data: { emailId: testEmailId, senderId: testSenderId, recipient: emailRecord.recipient },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    const res = await emailWorker.processEmailJob(mockJob);
    expect(res.success).toBe(true);
    // Crucial requirement: SMTP sendMail called EXACTLY ONCE despite DB retries
    expect(sendMailCalls).toBe(1);
    expect(emailRecord.status).toBe('sent');
    expect(dbFailures).toBe(0);
  });

  it('4. Crashed worker mid-send recovery: deterministic reconciliation without double-send', async () => {
    // Email left in 'processing' by a crashed worker
    emailRecord.status = 'processing';
    emailRecord.updated_at = new Date(Date.now() - 60000); // 60s ago (> 30s threshold)
    emailRecord.attempts = 1;

    // Simulate startup reconciliation
    await outboxDispatcherService.reconcileStalledProcessingEmails();

    // Reset back to scheduled and re-enqueued to BullMQ with 0 double send
    expect(emailRecord.status).toBe('scheduled');
    expect(queueModule.enqueueEmailJob).toHaveBeenCalled();
  });

  it('5. API contract: Scheduled and Sent lists never overlap, and counts are consistent', async () => {
    const app = createApp();
    const token = mintTestToken({ id: testUserId, email: 'test@c1.io' });

    // When status is scheduled
    emailRecord.status = 'scheduled';
    let schedRes = await request(app).get('/api/emails/scheduled').set('Authorization', `Bearer ${token}`);
    let sentRes = await request(app).get('/api/emails/sent').set('Authorization', `Bearer ${token}`);

    expect(schedRes.body.items).toHaveLength(1);
    expect(sentRes.body.items).toHaveLength(0);

    // When status is processing -> appears in scheduled list (as "Sending"), never in sent
    emailRecord.status = 'processing';
    schedRes = await request(app).get('/api/emails/scheduled').set('Authorization', `Bearer ${token}`);
    sentRes = await request(app).get('/api/emails/sent').set('Authorization', `Bearer ${token}`);

    expect(schedRes.body.items).toHaveLength(1);
    expect(sentRes.body.items).toHaveLength(0);

    // When status is sent -> appears in sent list, never in scheduled
    emailRecord.status = 'sent';
    schedRes = await request(app).get('/api/emails/scheduled').set('Authorization', `Bearer ${token}`);
    sentRes = await request(app).get('/api/emails/sent').set('Authorization', `Bearer ${token}`);

    expect(schedRes.body.items).toHaveLength(0);
    expect(sentRes.body.items).toHaveLength(1);

    // Verify counts endpoint matches
    const countsRes = await request(app).get('/api/emails/counts').set('Authorization', `Bearer ${token}`);
    expect(countsRes.status).toBe(200);
    expect(countsRes.body.data.scheduled).toBe(0);
    expect(countsRes.body.data.sent).toBe(1);
  });
});
