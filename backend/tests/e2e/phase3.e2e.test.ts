import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { createApp } from '../../src/app.js';
import { mintTestToken } from '../../src/lib/jwt.js';
import { EmailWorker } from '../../src/worker/email.worker.js';
import { rateLimiterService } from '../../src/services/rate-limiter.service.js';
import { slackService } from '../../src/services/slack.service.js';
import { encrypt } from '../../src/lib/crypto.js';
import * as prismaModule from '../../src/lib/prisma.js';
import * as queueModule from '../../src/queue/email.queue.js';
import * as slackQueueModule from '../../src/queue/slack.queue.js';

describe('Phase 3 E2E: Rate Limiting, Slack Notifications, Elasticsearch & Dashboard', () => {
  const app = createApp();

  const user = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    email: 'phase3.founder@example.com',
  };
  const token = mintTestToken(user);

  let etherealAccount: any;
  let senderId = '';

  const sendersStore: any[] = [];
  const campaignsStore: any[] = [];
  const emailsStore: any[] = [];
  const outboxStore: any[] = [];
  let slackConnection: any = null;
  const slackMessagesPosted: any[] = [];

  const mockPrisma: any = {
    user: {
      upsert: vi.fn().mockResolvedValue(user),
      findUnique: vi.fn().mockResolvedValue(user),
    },
    sender: {
      create: vi.fn().mockImplementation(({ data, select }) => {
        const id = randomUUID();
        const record = { id, ...data };
        sendersStore.push(record);
        if (select) {
          const res: any = {};
          for (const k of Object.keys(select)) res[k] = record[k];
          return Promise.resolve(res);
        }
        return Promise.resolve(record);
      }),
      findFirst: vi.fn().mockImplementation(({ where }) => {
        return Promise.resolve(
          sendersStore.find((s) => s.id === where.id && s.user_id === where.user_id) || null
        );
      }),
      findUnique: vi.fn().mockImplementation(({ where }) => {
        return Promise.resolve(sendersStore.find((s) => s.id === where.id) || null);
      }),
    },
    campaign: {
      create: vi.fn().mockImplementation(({ data }) => {
        campaignsStore.push(data);
        return Promise.resolve(data);
      }),
    },
    email: {
      createMany: vi.fn().mockImplementation(({ data }) => {
        emailsStore.push(...data);
        return Promise.resolve({ count: data.length });
      }),
      count: vi.fn().mockImplementation(({ where }) => {
        let list = emailsStore.filter((e) => e.user_id === where.user_id);
        if (where.status) list = list.filter((e) => e.status === where.status);
        return Promise.resolve(list.length);
      }),
      findMany: vi.fn().mockImplementation(({ where, skip = 0, take = 50 }) => {
        let list = emailsStore.filter((e) => e.user_id === where.user_id);
        if (where.status) list = list.filter((e) => e.status === where.status);
        if (where.OR) {
          list = list.filter(
            (e) =>
              e.subject.toLowerCase().includes('rate limit') ||
              e.recipient.toLowerCase().includes('lead')
          );
        }
        return Promise.resolve(list.slice(skip, skip + take));
      }),
      findUnique: vi.fn().mockImplementation(({ where }) => {
        const found = emailsStore.find((e) => e.id === where.id);
        if (found) {
          return Promise.resolve({
            ...found,
            campaign: { delay_seconds: 2, hourly_limit: 5 },
            sender: { email: etherealAccount.user, hourly_limit: 5 },
          });
        }
        return Promise.resolve(null);
      }),
      updateMany: vi.fn().mockImplementation(({ where, data }) => {
        let count = 0;
        emailsStore.forEach((e) => {
          if (e.id === where.id && e.status === where.status) {
            Object.assign(e, data);
            count++;
          }
        });
        return Promise.resolve({ count });
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        const e = emailsStore.find((em) => em.id === where.id);
        if (e) Object.assign(e, data);
        return Promise.resolve(e);
      }),
    },
    outboxEvent: {
      createMany: vi.fn().mockImplementation(({ data }) => {
        outboxStore.push(...data);
        return Promise.resolve({ count: data.length });
      }),
      create: vi.fn().mockImplementation(({ data }) => {
        outboxStore.push(data);
        return Promise.resolve(data);
      }),
    },
    slackConnection: {
      findUnique: vi.fn().mockImplementation(({ where }) => {
        if (slackConnection && slackConnection.user_id === where.user_id) {
          return Promise.resolve(slackConnection);
        }
        return Promise.resolve(null);
      }),
    },
    idempotencyKey: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation((cb) => cb(mockPrisma)),
  };

  beforeAll(async () => {
    vi.spyOn(prismaModule, 'getPrisma').mockReturnValue(mockPrisma);
    vi.spyOn(queueModule, 'enqueueEmailJob').mockResolvedValue({ id: 'job-1' } as any);
    vi.spyOn(slackQueueModule, 'enqueueSlackAlert').mockResolvedValue(undefined);
    etherealAccount = await nodemailer.createTestAccount();
  }, 25000);

  it('Step 1: Set up sender with hourly limit of 5 emails/hour and 2s delay', async () => {
    const res = await request(app)
      .post('/api/senders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Rate-Limited Sender',
        email: etherealAccount.user,
        host: etherealAccount.smtp.host,
        port: etherealAccount.smtp.port,
        secure: etherealAccount.smtp.secure,
        username: etherealAccount.user,
        password: etherealAccount.pass,
        hourly_limit: 5, // Strict limit of 5 per hour
      });

    expect(res.status).toBe(201);
    senderId = res.body.data.id;
    expect(senderId).toBeDefined();
  }, 15000);

  it('Step 2: Schedule 12 emails now; exactly 5 sent, 7 rescheduled to next window (never failed)', async () => {
    const recipients = Array.from({ length: 12 }, (_, i) => `lead.${i + 1}@startup.io`);

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'phase3-limit-test-12')
      .send({
        sender_id: senderId,
        subject: 'Rate Limit Benchmark',
        body: 'Testing atomic Lua admission and rescheduling.',
        recipients,
        delay_seconds: 2,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.totalScheduled).toBe(12);

    // Mock rateLimiterService to test admission boundary
    let admitted = 0;
    vi.spyOn(rateLimiterService, 'requestAdmission').mockImplementation(async () => {
      admitted++;
      if (admitted <= 5) {
        return {
          decision: 'GRANTED',
          currentCount: admitted,
          hourlyLimit: 5,
          shouldAlert: false,
          windowStartMs: Date.now(),
          windowEndMs: Date.now() + 3600000,
        };
      } else {
        return {
          decision: 'LIMIT_EXCEEDED',
          retryAtMs: Date.now() + 3600000,
          currentCount: 5,
          hourlyLimit: 5,
          shouldAlert: admitted === 6, // First over-limit hit triggers alert
          windowStartMs: Date.now(),
          windowEndMs: Date.now() + 3600000,
        };
      }
    });

    // Execute worker on all 12 emails
    const worker = new EmailWorker();
    const results = [];

    for (const email of emailsStore) {
      const mockJob: any = {
        id: `email:${email.id}`,
        data: {
          emailId: email.id,
          senderId,
          recipient: email.recipient,
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
      };
      const result = await worker.processEmailJob(mockJob);
      results.push(result);
    }

    const sent = results.filter((r) => r.success === true);
    const rescheduled = results.filter((r) => r.rescheduled === true && r.reason === 'LIMIT_EXCEEDED');

    expect(sent).toHaveLength(5);
    expect(rescheduled).toHaveLength(7);

    // Check database state: exactly 5 sent, 7 remaining in 'scheduled' state (NONE marked failed!)
    const sentCount = emailsStore.filter((e) => e.status === 'sent').length;
    const scheduledCount = emailsStore.filter((e) => e.status === 'scheduled').length;
    const failedCount = emailsStore.filter((e) => e.status === 'failed').length;

    expect(sentCount).toBe(5);
    expect(scheduledCount).toBe(7);
    expect(failedCount).toBe(0); // Zero failed emails!
  }, 25000);

  it('Step 3: Slack alert decoupled behavior (not connected: no crash; connected: message posted)', async () => {
    // 1. Alert when not connected -> completes cleanly without error
    const unconnectedResult = await slackService.sendRateLimitAlert({
      userId: user.id,
      senderId,
      senderEmail: etherealAccount.user,
      hourlyLimit: 5,
      currentCount: 5,
      windowStart: new Date().toISOString(),
      windowEnd: new Date(Date.now() + 3600000).toISOString(),
    });
    expect(unconnectedResult.skipped).toBe(true);

    // 2. User connects Slack later
    slackConnection = {
      user_id: user.id,
      team_id: 'T-REACHINBOX',
      team_name: 'ReachInbox Workspace',
      channel_id: 'C-ALERTS',
      channel_name: '#rate-limit-alerts',
      encrypted_access_token: encrypt('xoxb-valid-slack-test-token-12345'),
      encrypted_incoming_webhook: null,
      status: 'active',
    };

    // Spy on fetch for Slack chat.postMessage
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (typeof url === 'string' && url.includes('slack.com')) {
        slackMessagesPosted.push({ url });
        return {
          ok: true,
          json: async () => ({ ok: true, ts: '1770000001.000100', channel: 'C-ALERTS' }),
        } as any;
      }
      return fetch(url);
    });

    const connectedResult = await slackService.sendRateLimitAlert({
      userId: user.id,
      senderId,
      senderEmail: etherealAccount.user,
      hourlyLimit: 5,
      currentCount: 5,
      windowStart: '2026-10-14T02:00:00.000Z',
      windowEnd: '2026-10-14T03:00:00.000Z',
    });

    expect(connectedResult.success).toBe(true);
    expect(slackMessagesPosted).toHaveLength(1);
    fetchSpy.mockRestore();
  });

  it('Step 4: Search emails via /api/emails/search by recipient and subject', async () => {
    const searchRes = await request(app)
      .get('/api/emails/search?q=lead')
      .set('Authorization', `Bearer ${token}`);

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.items.length).toBeGreaterThan(0);
    expect(searchRes.body.pagination.total).toBeGreaterThan(0);
  });

  it('Step 5: Admin queue dashboard at /admin/queues is protected and operational', async () => {
    // Unauthenticated request rejected
    const unauthRes = await request(app).get('/admin/queues');
    expect(unauthRes.status).toBe(401);

    // Authenticated request accepted
    const authRes = await request(app)
      .get('/admin/queues')
      .set('Authorization', `Bearer ${token}`);

    expect([200, 301, 302]).toContain(authRes.status);
  });
});
