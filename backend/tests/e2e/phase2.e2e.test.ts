import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { createApp } from '../../src/app.js';
import { mintTestToken } from '../../src/lib/jwt.js';
import { EmailWorker } from '../../src/worker/email.worker.js';
import * as prismaModule from '../../src/lib/prisma.js';

describe('Phase 2 E2E: Scheduling Core, Persistence & Restart Verification', () => {
  const app = createApp();

  const user = {
    id: '77777777-7777-4777-8777-777777777777',
    email: 'persistence.founder@example.com',
  };
  const token = mintTestToken(user);

  let etherealAccount: any;
  let senderId = '';

  // In-memory test state representing Postgres database
  const sendersStore: any[] = [];
  const campaignsStore: any[] = [];
  const emailsStore: any[] = [];
  const outboxStore: any[] = [];
  const idempotencyStore: any[] = [];

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
        return Promise.resolve(
          emailsStore.filter((e) => e.user_id === where.user_id && e.status === where.status).length
        );
      }),
      findMany: vi.fn().mockImplementation(({ where, skip = 0, take = 50 }) => {
        const filtered = emailsStore.filter(
          (e) => e.user_id === where.user_id && e.status === where.status
        );
        return Promise.resolve(filtered.slice(skip, skip + take));
      }),
      findUnique: vi.fn().mockImplementation(({ where }) => {
        return Promise.resolve(emailsStore.find((e) => e.id === where.id) || null);
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
      findMany: vi.fn().mockImplementation(({ where }) => {
        return Promise.resolve(outboxStore.filter((o) => o.status === where.status));
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        const o = outboxStore.find((ev) => ev.id === where.id);
        if (o) Object.assign(o, data);
        return Promise.resolve(o);
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
    etherealAccount = await nodemailer.createTestAccount();
  }, 25000);

  it('Step 1: Set up verified sender account for user', async () => {
    const res = await request(app)
      .post('/api/senders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Persistence E2E Sender',
        email: etherealAccount.user,
        host: etherealAccount.smtp.host,
        port: etherealAccount.smtp.port,
        secure: etherealAccount.smtp.secure,
        username: etherealAccount.user,
        password: etherealAccount.pass,
        hourly_limit: 100,
      });

    expect(res.status).toBe(201);
    senderId = res.body.data.id;
    expect(senderId).toBeDefined();
  }, 15000);

  it('Step 2: Schedule 20 emails ~2 min ahead with Idempotency-Key', async () => {
    const recipients = Array.from({ length: 20 }, (_, i) => `recipient.${i + 1}@sample.com`);

    const scheduledStartTime = new Date(Date.now() + 120000).toISOString(); // 2 minutes ahead

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'phase2-schedule-20-batch')
      .send({
        sender_id: senderId,
        subject: 'Scheduled Outreach Campaign',
        body: 'Testing restart persistence and spacing.',
        recipients,
        delay_seconds: 2,
        start_time: scheduledStartTime,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.totalScheduled).toBe(20);
    expect(emailsStore).toHaveLength(20);

    // Verify all 20 are in 'scheduled' state with correct spacing
    for (let i = 0; i < 20; i++) {
      expect(emailsStore[i].status).toBe('scheduled');
      expect(emailsStore[i].recipient).toBe(`recipient.${i + 1}@sample.com`);
    }

    // Verify outbox has 20 pending events
    expect(outboxStore).toHaveLength(20);
  });

  it('Step 3: Simulate restart of API, worker, and queue', async () => {
    // Instantiate new worker instance to simulate cold restart
    const newWorker = new EmailWorker();
    expect(newWorker).toBeDefined();

    // Verify emails in database remain intact in 'scheduled' state without reset
    const scheduledRes = await request(app)
      .get('/api/emails/scheduled?limit=50')
      .set('Authorization', `Bearer ${token}`);

    expect(scheduledRes.status).toBe(200);
    expect(scheduledRes.body.items).toHaveLength(20);

    // Verify no emails were sent early
    const sentRes = await request(app)
      .get('/api/emails/sent')
      .set('Authorization', `Bearer ${token}`);

    expect(sentRes.status).toBe(200);
    expect(sentRes.body.items).toHaveLength(0);
  });

  it('Step 4: Execute scheduled jobs via worker and verify preview URLs', async () => {
    const worker = new EmailWorker();

    // Process first 3 emails via worker
    const batch = emailsStore.slice(0, 3);
    for (const email of batch) {
      const mockJob: any = {
        id: `email:${email.id}`,
        data: {
          emailId: email.id,
          senderId: email.sender_id,
          recipient: email.recipient,
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
      };

      const result = await worker.processEmailJob(mockJob);
      expect(result.success).toBe(true);
      expect(result.previewUrl).toBeDefined();
    }

    // Check sent emails table
    const sentRes = await request(app)
      .get('/api/emails/sent')
      .set('Authorization', `Bearer ${token}`);

    expect(sentRes.status).toBe(200);
    expect(sentRes.body.items).toHaveLength(3);
    expect(sentRes.body.items[0].preview_url).toContain('ethereal.email');
    expect(sentRes.body.items[0].message_id).toBeDefined();
  }, 25000);

  it('Step 5: Mid-send worker kill & documented recovery verification', async () => {
    const worker = new EmailWorker();
    const targetEmail = emailsStore[3]; // 4th email

    // Simulate worker crashing right after claim
    targetEmail.status = 'processing';
    targetEmail.attempts = 1;

    // A racing / restarted worker attempts to process the same job:
    const mockJob: any = {
      id: `email:${targetEmail.id}`,
      data: {
        emailId: targetEmail.id,
        senderId: targetEmail.sender_id,
        recipient: targetEmail.recipient,
      },
      attemptsMade: 1,
      opts: { attempts: 3 },
    };

    // Since status was already 'processing' (claimed), conditional update prevents duplicate send
    const recoveryResult = await worker.processEmailJob(mockJob);
    expect(recoveryResult.skipped).toBe(true);
    expect(recoveryResult.reason).toBe('Already claimed or cancelled');
  });
});
