import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import nodemailer from 'nodemailer';
import { createApp } from '../../src/app.js';
import { mintTestToken } from '../../src/lib/jwt.js';
import * as prismaModule from '../../src/lib/prisma.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.SUPABASE_JWT_SECRET = 'test-supabase-jwt-secret-at-least-32chars';
process.env.CREDENTIAL_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Phase 1 E2E: Real Ethereal Senders & Tenant Scoping', () => {
  const app = createApp();

  const userA = {
    id: 'aaaa1111-1111-4111-8111-111111111111',
    email: 'usera.founder@example.com',
  };
  const userB = {
    id: 'bbbb2222-2222-4222-8222-222222222222',
    email: 'userb.competitor@example.com',
  };

  const tokenA = mintTestToken(userA);
  const tokenB = mintTestToken(userB);

  // In-memory backing store for test environment when hosted db is not connected
  const sendersStore: any[] = [];
  const usersStore: any[] = [];

  beforeAll(() => {
    process.env.ADMIN_EMAILS = 'usera.founder@example.com';
    vi.spyOn(prismaModule, 'getPrisma').mockReturnValue(mockPrisma);
  });

  const mockPrisma: any = {
    user: {
      upsert: vi.fn().mockImplementation(({ create }) => {
        const role = (process.env.ADMIN_EMAILS || '').includes(create.email) ? 'admin' : (create.role || 'user');
        const user = { ...create, role };
        usersStore.push(user);
        return Promise.resolve(user);
      }),
      findUnique: vi.fn().mockImplementation(({ where }) => {
        return Promise.resolve(usersStore.find((u) => u.id === where.id) || null);
      }),
    },
    sender: {
      create: vi.fn().mockImplementation(({ data, select }) => {
        const record = {
          id: 'sender-' + Math.random().toString(36).substring(7),
          ...data,
          created_at: new Date(),
          updated_at: new Date(),
        };
        sendersStore.push(record);
        if (select) {
          const result: any = {};
          for (const key of Object.keys(select)) {
            result[key] = record[key];
          }
          return Promise.resolve(result);
        }
        return Promise.resolve(record);
      }),
      findMany: vi.fn().mockImplementation(({ where, skip = 0, take = 20 }) => {
        const filtered = where?.user_id ? sendersStore.filter((s) => s.user_id === where.user_id) : sendersStore;
        const sliced = filtered.slice(skip, skip + take);
        return Promise.resolve(
          sliced.map((s) => ({
            id: s.id,
            user_id: s.user_id,
            name: s.name,
            email: s.email,
            host: s.host,
            port: s.port,
            secure: s.secure,
            hourly_limit: s.hourly_limit,
            status: s.status,
            created_at: s.created_at,
            updated_at: s.updated_at,
          }))
        );
      }),
      count: vi.fn().mockImplementation(({ where }) => {
        const filtered = where?.user_id ? sendersStore.filter((s) => s.user_id === where.user_id) : sendersStore;
        return Promise.resolve(filtered.length);
      }),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
  };

  it('Step 1: Health check responds properly', async () => {
    const res = await request(app).get('/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('services');
  }, 10000);

  it('Step 2: Create 2 real Ethereal accounts and register for User A', async () => {
    // Generate 2 genuine Ethereal SMTP accounts via Nodemailer
    const [ethereal1, ethereal2] = await Promise.all([
      nodemailer.createTestAccount(),
      nodemailer.createTestAccount(),
    ]);

    expect(ethereal1.user).toBeDefined();
    expect(ethereal2.user).toBeDefined();

    // User A (admin) registers Sender 1
    const res1 = await request(app)
      .post('/api/senders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Ethereal Sender 1',
        email: ethereal1.user,
        host: ethereal1.smtp.host,
        port: ethereal1.smtp.port,
        secure: ethereal1.smtp.secure,
        username: ethereal1.user,
        password: ethereal1.pass,
        hourly_limit: 50,
      });

    expect(res1.status).toBe(201);
    expect(res1.body.data.email).toBe(ethereal1.user);
    expect(res1.body.data.name).toBe('Ethereal Sender 1');
    expect(res1.body.data.password).toBeUndefined();

    // User A (admin) registers Sender 2
    const res2 = await request(app)
      .post('/api/senders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Ethereal Sender 2',
        email: ethereal2.user,
        host: ethereal2.smtp.host,
        port: ethereal2.smtp.port,
        secure: ethereal2.smtp.secure,
        username: ethereal2.user,
        password: ethereal2.pass,
        hourly_limit: 50,
      });

    expect(res2.status).toBe(201);
    expect(res2.body.data.email).toBe(ethereal2.user);
  }, 30000);

  it('Step 3: User A (admin) lists senders and sees both with admin fields', async () => {
    const listRes = await request(app)
      .get('/api/senders')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(2);
    expect(listRes.body.pagination.total).toBe(2);
    expect(listRes.body.items[0].host).toBeDefined();
  });

  it('Step 4: User B (non-admin) lists senders and sees shared senders safely without credentials, cannot create', async () => {
    // Non-admin sees shared senders for compose dropdown
    const listRes = await request(app)
      .get('/api/senders')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(2);
    // Credentials stripped for non-admin
    expect(listRes.body.items[0].host).toBeUndefined();
    expect(listRes.body.items[0].port).toBeUndefined();
    expect(listRes.body.items[0].password).toBeUndefined();

    // Non-admin cannot create senders
    const createRes = await request(app)
      .post('/api/senders')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        name: 'Hacker Sender',
        email: 'hacker@example.com',
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        username: 'hacker',
        password: 'password',
        hourly_limit: 100,
      });
    expect(createRes.status).toBe(403);
  });

  it('Step 5: Bad SMTP credentials are authenticated against server and rejected', async () => {
    const res = await request(app)
      .post('/api/senders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Bogus Sender',
        email: 'bogus@example.com',
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        username: 'definitely-fake-user-998877@ethereal.email',
        password: 'fakePassword123!',
        hourly_limit: 50,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SMTP_CREDENTIALS');
  }, 15000);
});
