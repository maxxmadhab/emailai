import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { mintTestToken } from '../../src/lib/jwt.js';
import * as prismaModule from '../../src/lib/prisma.js';

describe('Idempotency Layer Integration Tests', () => {
  const app = createApp();
  const userId = '33333333-3333-4333-8333-333333333333';
  const token = mintTestToken({ id: userId, email: 'idempotent@example.com' });

  const idempotencyStore: Map<string, any> = new Map();

  const mockPrisma: any = {
    user: {
      upsert: vi.fn().mockResolvedValue({ id: userId, email: 'idempotent@example.com' }),
      findUnique: vi.fn().mockResolvedValue({ id: userId, email: 'idempotent@example.com' }),
    },
    sender: {
      findFirst: vi.fn().mockResolvedValue({
        id: '12345678-1234-1234-1234-123456789abc',
        user_id: userId,
        hourly_limit: 50,
      }),
    },
    campaign: {
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, id: 'campaign-123' })),
    },
    email: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    outboxEvent: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn().mockImplementation((cb) => cb(mockPrisma)),
    idempotencyKey: {
      findUnique: vi.fn().mockImplementation(({ where }) => {
        const key = `${where.user_id_key.user_id}:${where.user_id_key.key}`;
        return Promise.resolve(idempotencyStore.get(key) || null);
      }),
      create: vi.fn().mockImplementation(({ data }) => {
        const key = `${data.user_id}:${data.key}`;
        if (idempotencyStore.has(key)) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
        const record = { ...data, response_status: null, response_body: null };
        idempotencyStore.set(key, record);
        return Promise.resolve(record);
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        const key = `${where.user_id_key.user_id}:${where.user_id_key.key}`;
        const existing = idempotencyStore.get(key) || {};
        const updated = { ...existing, ...data };
        idempotencyStore.set(key, updated);
        return Promise.resolve(updated);
      }),
    },
  };

  beforeEach(() => {
    idempotencyStore.clear();
    vi.spyOn(prismaModule, 'getPrisma').mockReturnValue(mockPrisma);
  });

  it('rejects POST /api/campaigns without Idempotency-Key header', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sender_id: '12345678-1234-1234-1234-123456789abc',
        subject: 'No Idempotency Key',
        body: 'Body',
        recipients: ['recipient@example.com'],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('successfully creates campaign and caches response for subsequent identical retries', async () => {
    const idempotencyKey = 'unique-key-1001';
    const payload = {
      sender_id: '12345678-1234-1234-1234-123456789abc',
      subject: 'Idempotent Campaign',
      body: 'Hello there!',
      recipients: ['first@example.com'],
    };

    // First request
    const firstRes = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(firstRes.status).toBe(201);
    expect(firstRes.body.data.campaign.subject).toBe('Idempotent Campaign');

    // Wait microtask for async update
    await new Promise((r) => setTimeout(r, 20));

    // Second request with identical payload and key
    const secondRes = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(secondRes.status).toBe(201);
    expect(secondRes.body.data.campaign.subject).toBe('Idempotent Campaign');
    // Ensure campaign.create was called only ONCE in the database!
    expect(mockPrisma.campaign.create).toHaveBeenCalledTimes(1);
  });

  it('rejects retry with the same Idempotency-Key but modified payload (422)', async () => {
    const idempotencyKey = 'unique-key-1002';
    const initialPayload = {
      sender_id: '12345678-1234-1234-1234-123456789abc',
      subject: 'Initial Subject',
      body: 'Body',
      recipients: ['first@example.com'],
    };

    const firstRes = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(initialPayload);

    expect(firstRes.status).toBe(201);
    await new Promise((r) => setTimeout(r, 20));

    // Changed payload with same key
    const changedPayload = {
      ...initialPayload,
      subject: 'Modified Subject Attack',
    };

    const secondRes = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(changedPayload);

    expect(secondRes.status).toBe(422);
    expect(secondRes.body.error.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
  });
});
