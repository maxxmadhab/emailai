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

process.env.ADMIN_EMAILS = 'usera@example.com';

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
  const usersDb: any[] = [
    { ...userA, role: 'admin' },
    { ...userB, role: 'user' },
  ];

  const mockPrisma: any = {
    user: {
      upsert: vi.fn().mockImplementation(({ create, update }) => {
        let existing = usersDb.find((u) => u.id === create.id);
        if (!existing) {
          existing = { ...create };
          usersDb.push(existing);
        } else if (update) {
          Object.assign(existing, update);
        }
        return Promise.resolve(existing);
      }),
      findUnique: vi.fn().mockImplementation(({ where }) => {
        return Promise.resolve(usersDb.find((u) => u.id === where.id) || null);
      }),
      count: vi.fn().mockResolvedValue(usersDb.length),
    },
    sender: {
      create: vi.fn().mockImplementation(({ data, select }) => {
        const record = {
          id: 'test-sender-id-' + Math.random().toString(36).substring(7),
          ...data,
          is_shared: true,
          min_delay_seconds: 2,
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
      findMany: vi.fn().mockImplementation(() => {
        return Promise.resolve(sendersDb.map((s) => ({ ...s })));
      }),
      count: vi.fn().mockImplementation(() => Promise.resolve(sendersDb.length)),
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

    // User B (regular user) lists senders -> sees the shared sender with safe public shape (no host, port, or credentials)
    const listBRes = await request(app)
      .get('/api/senders')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(listBRes.status).toBe(200);
    expect(listBRes.body.items).toHaveLength(1);
    expect(listBRes.body.items[0].smtp_host).toBeUndefined();
    expect(listBRes.body.items[0].smtp_port).toBeUndefined();
    expect(listBRes.body.items[0].password).toBeUndefined();
    expect(listBRes.body.items[0].encrypted_password).toBeUndefined();

    // User B attempts to create a sender -> rejected with 403 FORBIDDEN
    const userBCreateRes = await request(app)
      .post('/api/senders')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        name: 'User B Sender',
        email: 'userb@smtp.ethereal.email',
        host: 'smtp.ethereal.email',
        port: 587,
        username: 'userb',
        password: 'pass',
      });
    expect(userBCreateRes.status).toBe(403);
    expect(userBCreateRes.body.error.code).toBe('FORBIDDEN');
  });
});
