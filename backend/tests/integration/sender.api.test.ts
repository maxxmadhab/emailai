import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { mintTestToken } from '../../src/lib/jwt.js';
import { senderService } from '../../src/services/sender.service.js';
import * as prismaModule from '../../src/lib/prisma.js';

// Setup environment for testing
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.SUPABASE_JWT_SECRET = 'test-supabase-jwt-secret-at-least-32chars';
process.env.CREDENTIAL_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Sender API & Tenant Isolation', () => {
  const app = createApp();

  const userA = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'userA@example.com',
  };
  const userB = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'userB@example.com',
  };

  const tokenA = mintTestToken(userA);
  const tokenB = mintTestToken(userB);

  // In-memory store to simulate database for unit/integration testing
  const sendersDb: any[] = [];
  const usersDb: any[] = [];

  const mockPrisma: any = {
    user: {
      upsert: vi.fn().mockImplementation(({ create }) => {
        usersDb.push(create);
        return Promise.resolve(create);
      }),
      findUnique: vi.fn().mockImplementation(({ where }) => {
        return Promise.resolve(usersDb.find((u) => u.id === where.id) || null);
      }),
    },
    sender: {
      create: vi.fn().mockImplementation(({ data, select }) => {
        const record = {
          id: 'test-sender-id-' + Math.random().toString(36).substring(7),
          ...data,
          created_at: new Date(),
          updated_at: new Date(),
        };
        sendersDb.push(record);
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
        const filtered = sendersDb.filter((s) => s.user_id === where.user_id);
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
        return Promise.resolve(sendersDb.filter((s) => s.user_id === where.user_id).length);
      }),
    },
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.spyOn(prismaModule, 'getPrisma').mockReturnValue(mockPrisma);
  });

  it('rejects unauthenticated requests to /api/senders with 401', async () => {
    const res = await request(app).get('/api/senders');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects invalid request body with 400 validation error', async () => {
    const res = await request(app)
      .post('/api/senders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: '',
        email: 'invalid-email',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects non-existent / unreachable SMTP server with 400 INVALID_SMTP_CREDENTIALS', async () => {
    // Attempting to verify credentials on an unreachable host fails
    const res = await request(app)
      .post('/api/senders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Bad SMTP Sender',
        email: 'sender@badhost.invalid',
        host: '127.0.0.1',
        port: 9999, // Unused port
        secure: false,
        username: 'baduser',
        password: 'badpassword',
        hourly_limit: 50,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SMTP_CREDENTIALS');
  });

  it('enforces strict tenant isolation between user A and user B', async () => {
    // Stub SMTP verify for this specific isolation test
    vi.spyOn(senderService, 'verifySmtpCredentials').mockResolvedValueOnce({ success: true });

    // User A adds a sender
    const createRes = await request(app)
      .post('/api/senders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'User A Sender',
        email: 'usera@smtp.ethereal.email',
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        username: 'usera@smtp.ethereal.email',
        password: 'secretPasswordA',
        hourly_limit: 100,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.name).toBe('User A Sender');
    // Ensure passwords or raw encrypted secrets are NEVER returned in response
    expect(createRes.body.data.password).toBeUndefined();
    expect(createRes.body.data.encrypted_password).toBeUndefined();

    // User A lists senders -> sees 1 sender
    const listARes = await request(app)
      .get('/api/senders')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(listARes.status).toBe(200);
    expect(listARes.body.items).toHaveLength(1);
    expect(listARes.body.items[0].name).toBe('User A Sender');

    // User B lists senders -> sees 0 senders!
    const listBRes = await request(app)
      .get('/api/senders')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(listBRes.status).toBe(200);
    expect(listBRes.body.items).toHaveLength(0);
    expect(listBRes.body.pagination.total).toBe(0);
  });
});
