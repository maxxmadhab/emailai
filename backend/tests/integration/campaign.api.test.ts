import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { mintTestToken } from '../../src/lib/jwt.js';
import * as prismaModule from '../../src/lib/prisma.js';
import * as queueModule from '../../src/queue/email.queue.js';

describe('Campaign & Email API Endpoints', () => {
  const app = createApp();

  const userA = { id: '44444444-4444-4444-8444-444444444444', email: 'userA@campaign.com' };
  const userB = { id: '55555555-5555-4555-8555-555555555555', email: 'userB@campaign.com' };

  const tokenA = mintTestToken(userA);
  const tokenB = mintTestToken(userB);

  const senderA = {
    id: '11111111-aaaa-4111-8111-111111111111',
    user_id: userA.id,
    name: 'Sender A',
    email: 'senderA@ethereal.email',
    hourly_limit: 50,
  };

  const emailsDb: any[] = [];
  const campaignsDb: any[] = [];

  const mockPrisma: any = {
    user: {
      upsert: vi.fn().mockResolvedValue(userA),
      findUnique: vi.fn().mockResolvedValue(userA),
    },
    sender: {
      findFirst: vi.fn().mockImplementation(({ where }) => {
        if (where.id === senderA.id && where.user_id === userA.id) {
          return Promise.resolve(senderA);
        }
        return Promise.resolve(null);
      }),
    },
    campaign: {
      create: vi.fn().mockImplementation(({ data }) => {
        campaignsDb.push(data);
        return Promise.resolve(data);
      }),
    },
    email: {
      createMany: vi.fn().mockImplementation(({ data }) => {
        emailsDb.push(...data);
        return Promise.resolve({ count: data.length });
      }),
      count: vi.fn().mockImplementation(({ where }) => {
        return Promise.resolve(
          emailsDb.filter((e) => e.user_id === where.user_id && e.status === where.status).length
        );
      }),
      findMany: vi.fn().mockImplementation(({ where, skip = 0, take = 20 }) => {
        const filtered = emailsDb.filter(
          (e) => e.user_id === where.user_id && e.status === where.status
        );
        return Promise.resolve(filtered.slice(skip, skip + take));
      }),
      findFirst: vi.fn().mockImplementation(({ where }) => {
        return Promise.resolve(
          emailsDb.find((e) => e.id === where.id && e.user_id === where.user_id) || null
        );
      }),
      findUnique: vi.fn().mockImplementation(({ where }) => {
        return Promise.resolve(emailsDb.find((e) => e.id === where.id) || null);
      }),
      updateMany: vi.fn().mockImplementation(({ where, data }) => {
        let count = 0;
        emailsDb.forEach((e) => {
          if (e.id === where.id && e.user_id === where.user_id && e.status === where.status) {
            Object.assign(e, data);
            count++;
          }
        });
        return Promise.resolve({ count });
      }),
    },
    outboxEvent: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    idempotencyKey: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation((cb) => cb(mockPrisma)),
  };

  beforeEach(() => {
    emailsDb.length = 0;
    campaignsDb.length = 0;
    vi.spyOn(prismaModule, 'getPrisma').mockReturnValue(mockPrisma);
    vi.spyOn(queueModule, 'enqueueEmailJob').mockResolvedValue({ id: 'mock-job-id' } as any);
    vi.spyOn(queueModule, 'removeEmailJob').mockResolvedValue(true);
  });

  it('rejects campaign scheduling if sender belongs to another user (tenant isolation)', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenB}`) // User B trying to use User A's sender
      .set('Idempotency-Key', 'key-isolation-1')
      .send({
        sender_id: senderA.id,
        subject: 'Hacked Campaign',
        body: 'Body',
        recipients: ['victim@example.com'],
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SENDER_NOT_FOUND');
  });

  it('creates campaign and scheduled emails from multipart CSV upload', async () => {
    const csvContent = 'Email\nlead1@company.com\nlead2@company.com';

    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Idempotency-Key', 'csv-campaign-key-1')
      .field('sender_id', senderA.id)
      .field('subject', 'Quarterly Outreach')
      .field('body', 'Hello {{lead}}, check out our platform!')
      .field('delay_seconds', 3)
      .attach('file', Buffer.from(csvContent), 'leads.csv');

    expect(res.status).toBe(201);
    expect(res.body.data.totalScheduled).toBe(2);
    expect(emailsDb).toHaveLength(2);
    expect(emailsDb[0].recipient).toBe('lead1@company.com');
    expect(emailsDb[1].recipient).toBe('lead2@company.com');
  });

  it('lists scheduled emails scoped to authenticated tenant', async () => {
    // Add an email for User A and an email for User B
    emailsDb.push(
      {
        id: 'email-a-1',
        user_id: userA.id,
        recipient: 'lead1@company.com',
        status: 'scheduled',
        scheduled_at: new Date(),
      },
      {
        id: 'email-b-1',
        user_id: userB.id,
        recipient: 'secret@competitor.com',
        status: 'scheduled',
        scheduled_at: new Date(),
      }
    );

    // User A fetches scheduled emails
    const resA = await request(app)
      .get('/api/emails/scheduled')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resA.status).toBe(200);
    expect(resA.body.items).toHaveLength(1);
    expect(resA.body.items[0].recipient).toBe('lead1@company.com');

    // User B fetches scheduled emails
    const resB = await request(app)
      .get('/api/emails/scheduled')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(resB.status).toBe(200);
    expect(resB.body.items).toHaveLength(1);
    expect(resB.body.items[0].recipient).toBe('secret@competitor.com');
  });

  it('cancels scheduled email and prevents unauthorized cancel by another tenant', async () => {
    emailsDb.push({
      id: 'cancel-test-id',
      user_id: userA.id,
      recipient: 'cancel@example.com',
      status: 'scheduled',
      scheduled_at: new Date(),
    });

    // User B attempts to cancel User A's email -> 404
    const unauthorizedRes = await request(app)
      .post('/api/emails/cancel-test-id/cancel')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(unauthorizedRes.status).toBe(404);

    // User A cancels their email -> 200
    const cancelRes = await request(app)
      .post('/api/emails/cancel-test-id/cancel')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('cancelled');
    expect(queueModule.removeEmailJob).toHaveBeenCalledWith('cancel-test-id');
  });
});
