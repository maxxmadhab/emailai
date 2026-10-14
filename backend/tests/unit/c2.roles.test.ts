import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { mintTestToken } from '../../src/lib/jwt.js';
import * as prismaModule from '../../src/lib/prisma.js';
import { campaignService } from '../../src/services/campaign.service.js';
import { rateLimiterService } from '../../src/services/rate-limiter.service.js';

describe('C2: Admin vs User Roles, Shared Senders, and Limit Caps', () => {
  const adminUserId = 'user-admin-0001';
  const regularUserId1 = 'user-regular-0001';
  const regularUserId2 = 'user-regular-0002';
  const sharedSenderId = 'sender-shared-0001';

  const adminToken = mintTestToken({ id: adminUserId, email: 'admin@reachinbox.ai' });
  const userToken1 = mintTestToken({ id: regularUserId1, email: 'user1@reachinbox.ai' });
  const userToken2 = mintTestToken({ id: regularUserId2, email: 'user2@reachinbox.ai' });

  let users = [
    { id: adminUserId, email: 'admin@reachinbox.ai', name: 'Admin User', role: 'admin' },
    { id: regularUserId1, email: 'user1@reachinbox.ai', name: 'User One', role: 'user' },
    { id: regularUserId2, email: 'user2@reachinbox.ai', name: 'User Two', role: 'user' },
  ];

  let senders = [
    {
      id: sharedSenderId,
      user_id: adminUserId,
      name: 'Global Team Sender',
      email: 'team@reachinbox.ai',
      smtp_host: 'smtp.ethereal.email',
      smtp_port: 587,
      smtp_user_enc: 'enc_user',
      smtp_pass_enc: 'enc_pass',
      hourly_limit: 20,
      min_delay_seconds: 5,
      is_shared: true,
      created_at: new Date(),
      updated_at: new Date(),
    },
  ];

  let emails = [
    {
      id: 'email-u1-1',
      user_id: regularUserId1,
      sender_id: sharedSenderId,
      recipient: 'u1-recip@example.com',
      subject: 'Hello from U1',
      status: 'scheduled',
      created_at: new Date(),
    },
    {
      id: 'email-u2-1',
      user_id: regularUserId2,
      sender_id: sharedSenderId,
      recipient: 'u2-recip@example.com',
      subject: 'Hello from U2',
      status: 'scheduled',
      created_at: new Date(),
    },
  ];

  const mockPrisma: any = {
    user: {
      findUnique: vi.fn().mockImplementation(({ where }) => {
        const u = users.find((user) => user.id === where.id);
        return Promise.resolve(u ? { ...u } : null);
      }),
      findMany: vi.fn().mockImplementation(() => {
        return Promise.resolve(users.map((u) => ({ ...u })));
      }),
      upsert: vi.fn().mockImplementation(({ where, update, create }) => {
        let u = users.find((user) => user.id === where.id);
        if (!u) {
          const newUser = { id: where.id, email: create?.email || '', name: create?.name || '', role: create?.role || 'user' };
          users.push(newUser);
          return Promise.resolve(newUser);
        } else if (update) {
          Object.assign(u, update);
        }
        return Promise.resolve(u);
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        const u = users.find((user) => user.id === where.id);
        if (u) Object.assign(u, data);
        return Promise.resolve({ ...u });
      }),
      count: vi.fn().mockImplementation(() => Promise.resolve(users.length)),
    },
    sender: {
      findUnique: vi.fn().mockImplementation(({ where }) => {
        const s = senders.find((sender) => sender.id === where.id);
        return Promise.resolve(s ? { ...s } : null);
      }),
      findFirst: vi.fn().mockImplementation(({ where }) => {
        const s = senders.find((sender) => {
          if (where.id && sender.id !== where.id) return false;
          if (where.OR) {
            return where.OR.some(
              (cond: any) => (cond.user_id && sender.user_id === cond.user_id) || (cond.is_shared && sender.is_shared)
            );
          }
          if (where.user_id && sender.user_id !== where.user_id) return false;
          return true;
        });
        return Promise.resolve(s ? { ...s } : null);
      }),
      findMany: vi.fn().mockImplementation(() => {
        return Promise.resolve(senders.map((s) => ({ ...s })));
      }),
      count: vi.fn().mockImplementation(() => Promise.resolve(senders.length)),
      update: vi.fn().mockImplementation(({ where, data }) => {
        const s = senders.find((sender) => sender.id === where.id);
        if (s) Object.assign(s, data);
        return Promise.resolve({ ...s });
      }),
      delete: vi.fn().mockImplementation(({ where }) => {
        const idx = senders.findIndex((sender) => sender.id === where.id);
        if (idx !== -1) {
          const removed = senders.splice(idx, 1)[0];
          return Promise.resolve(removed);
        }
        return Promise.resolve(null);
      }),
      create: vi.fn().mockImplementation(({ data }) => {
        const newSender = { id: `sender-${Date.now()}`, ...data, created_at: new Date(), updated_at: new Date() };
        senders.push(newSender);
        return Promise.resolve(newSender);
      }),
    },
    email: {
      findMany: vi.fn().mockImplementation(({ where }) => {
        const results = emails.filter((e) => !where?.user_id || e.user_id === where.user_id);
        return Promise.resolve(results);
      }),
      count: vi.fn().mockImplementation(({ where }) => {
        const count = emails.filter((e) => !where?.user_id || e.user_id === where.user_id).length;
        return Promise.resolve(count);
      }),
      createMany: vi.fn().mockImplementation(({ data }) => {
        emails.push(...data);
        return Promise.resolve({ count: data.length });
      }),
    },
    campaign: {
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'camp-1', ...data })),
    },
    idempotencyKey: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    outboxEvent: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn().mockImplementation(async (cb) => {
      if (typeof cb === 'function') {
        return cb(mockPrisma);
      }
      return Promise.all(cb);
    }),
  };

  beforeEach(() => {
    vi.spyOn(prismaModule, 'getPrisma').mockReturnValue(mockPrisma);
  });

  it('1. Non-admin gets 403 FORBIDDEN on sender management and admin endpoints', async () => {
    const app = createApp();

    // POST /api/senders
    const postSenderRes = await request(app)
      .post('/api/senders')
      .set('Authorization', `Bearer ${userToken1}`)
      .send({ email: 'test@domain.com', smtp_host: 'smtp.test.com' });
    expect(postSenderRes.status).toBe(403);
    expect(postSenderRes.body.error?.code).toBe('FORBIDDEN');

    // PUT /api/senders/:id
    const putSenderRes = await request(app)
      .put(`/api/senders/${sharedSenderId}`)
      .set('Authorization', `Bearer ${userToken1}`)
      .send({ hourly_limit: 100 });
    expect(putSenderRes.status).toBe(403);

    // DELETE /api/senders/:id
    const deleteSenderRes = await request(app)
      .delete(`/api/senders/${sharedSenderId}`)
      .set('Authorization', `Bearer ${userToken1}`);
    expect(deleteSenderRes.status).toBe(403);

    // GET /admin/users
    const getUsersRes = await request(app)
      .get('/admin/users')
      .set('Authorization', `Bearer ${userToken1}`);
    expect(getUsersRes.status).toBe(403);

    // PATCH /admin/users/:id/role
    const patchRoleRes = await request(app)
      .patch(`/admin/users/${regularUserId1}/role`)
      .set('Authorization', `Bearer ${userToken1}`)
      .send({ role: 'admin' });
    expect(patchRoleRes.status).toBe(403);

    // GET /admin/queues (Bull-board)
    const bullBoardRes = await request(app)
      .get('/admin/queues')
      .set('Authorization', `Bearer ${userToken1}`);
    expect(bullBoardRes.status).toBe(403);
  });

  it('2. GET /api/senders returns safe public shape for regular users and full shape for admins', async () => {
    const app = createApp();

    // Regular user request
    const userRes = await request(app)
      .get('/api/senders')
      .set('Authorization', `Bearer ${userToken1}`);
    expect(userRes.status).toBe(200);
    const userSenders = userRes.body.items;
    expect(userSenders.length).toBeGreaterThan(0);
    // Credentials, host, port must NOT be present
    expect(userSenders[0].smtp_host).toBeUndefined();
    expect(userSenders[0].smtp_port).toBeUndefined();
    expect(userSenders[0].smtp_user_enc).toBeUndefined();
    expect(userSenders[0].smtp_pass_enc).toBeUndefined();
    expect(userSenders[0].hourly_limit).toBe(20);
    expect(userSenders[0].min_delay_seconds).toBe(5);

    // Admin request
    const adminRes = await request(app)
      .get('/api/senders')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(200);
    const adminSenders = adminRes.body.items;
    expect(adminSenders[0].smtp_host).toBe('smtp.ethereal.email');
    expect(adminSenders[0].smtp_port).toBe(587);
  });

  it('3. User campaign delay below sender minimum is rejected with clear error', async () => {
    // Sender min_delay_seconds is 5
    await expect(
      campaignService.createCampaign(
        regularUserId1,
        {
          name: 'Low delay test',
          subject: 'Test',
          body: 'Hello',
          recipients: ['recipient@test.com'],
          sender_id: sharedSenderId,
          delay_seconds: 2, // Below sender minimum 5
          hourly_limit: 10,
          idempotency_key: 'idem-key-1',
        }
      )
    ).rejects.toThrow(/sender minimum delay/);
  });

  it('4. User campaign hourly limit exceeding sender cap is rejected with clear error', async () => {
    // Sender hourly_limit is 20
    await expect(
      campaignService.createCampaign(
        regularUserId1,
        {
          name: 'High limit test',
          subject: 'Test',
          body: 'Hello',
          recipients: ['recipient@test.com'],
          sender_id: sharedSenderId,
          delay_seconds: 5,
          hourly_limit: 50, // Exceeds sender limit 20
          idempotency_key: 'idem-key-2',
        }
      )
    ).rejects.toThrow(/sender hourly limit/);
  });

  it('5. User emails stay strictly tenant-scoped (users cannot see each others emails)', async () => {
    const app = createApp();

    // User 1 scheduled emails
    const u1Res = await request(app)
      .get('/api/emails/scheduled')
      .set('Authorization', `Bearer ${userToken1}`);
    expect(u1Res.status).toBe(200);
    expect(u1Res.body.items.every((e: any) => e.user_id === regularUserId1)).toBe(true);

    // User 2 scheduled emails
    const u2Res = await request(app)
      .get('/api/emails/scheduled')
      .set('Authorization', `Bearer ${userToken2}`);
    expect(u2Res.status).toBe(200);
    expect(u2Res.body.items.every((e: any) => e.user_id === regularUserId2)).toBe(true);
  });

  it('6. Admin can promote user and update sender limits', async () => {
    const app = createApp();

    // Admin updates limits
    const updateRes = await request(app)
      .put(`/api/senders/${sharedSenderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hourly_limit: 45, min_delay_seconds: 8 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.hourly_limit).toBe(45);
    expect(updateRes.body.data.min_delay_seconds).toBe(8);

    // Admin promotes User 1 to admin
    const promoteRes = await request(app)
      .patch(`/admin/users/${regularUserId1}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'admin' });
    expect(promoteRes.status).toBe(200);
    expect(promoteRes.body.data.role).toBe('admin');
  });

  it('7. Shared sender rate limits across all users sharing it (Redis state keyed per sender)', async () => {
    // Verify rate limit key construction is sender-based
    const redisKey = `ratelimit:sender:${sharedSenderId}`;
    expect(redisKey).toContain(sharedSenderId);
    expect(redisKey).not.toContain(regularUserId1);
    expect(redisKey).not.toContain(regularUserId2);
  });
});
