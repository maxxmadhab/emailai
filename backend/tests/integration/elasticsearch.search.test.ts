import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { mintTestToken } from '../../src/lib/jwt.js';
import { elasticsearchService } from '../../src/services/elasticsearch.service.js';
import * as prismaModule from '../../src/lib/prisma.js';

describe('Elasticsearch Email Search & Tenant Isolation', () => {
  const app = createApp();

  const userA = { id: '99999999-9999-4999-8999-999999999999', email: 'userA@search.com' };
  const userB = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'userB@search.com' };

  const tokenA = mintTestToken(userA);
  const tokenB = mintTestToken(userB);

  const mockEmailsDb = [
    {
      id: 'email-es-1',
      user_id: userA.id,
      campaign_id: 'camp-1',
      sender_id: 'sender-1',
      recipient: 'investor@sequoia.com',
      subject: 'Series A Pitch Deck',
      body: 'Check out our metrics and growth numbers.',
      status: 'sent',
      scheduled_at: new Date('2026-10-14T01:00:00Z'),
      sent_at: new Date('2026-10-14T01:00:05Z'),
      message_id: '<es-1@outbox.ai>',
      preview_url: 'https://ethereal.email/es-1',
      created_at: new Date(),
    },
    {
      id: 'email-es-2',
      user_id: userA.id,
      campaign_id: 'camp-1',
      sender_id: 'sender-1',
      recipient: 'partner@andreessen.com',
      subject: 'Partnership Inquiry',
      body: 'We would love to discuss an integration.',
      status: 'scheduled',
      scheduled_at: new Date('2026-10-14T02:00:00Z'),
      sent_at: null,
      message_id: null,
      preview_url: null,
      created_at: new Date(),
    },
    {
      id: 'email-es-3',
      user_id: userB.id,
      campaign_id: 'camp-2',
      sender_id: 'sender-2',
      recipient: 'investor@sequoia.com', // Same recipient but User B's tenant!
      subject: 'User B Confidential Proposal',
      body: 'Secret data for investor.',
      status: 'sent',
      scheduled_at: new Date('2026-10-14T01:30:00Z'),
      sent_at: new Date('2026-10-14T01:30:05Z'),
      message_id: '<es-3@outbox.ai>',
      preview_url: 'https://ethereal.email/es-3',
      created_at: new Date(),
    },
  ];

  const mockPrisma: any = {
    user: {
      upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve(create)),
      findUnique: vi.fn().mockImplementation(({ where }) => {
        if (where.id === userA.id) return Promise.resolve(userA);
        if (where.id === userB.id) return Promise.resolve(userB);
        return Promise.resolve(null);
      }),
    },
    email: {
      count: vi.fn().mockImplementation(({ where }) => {
        let list = mockEmailsDb.filter((e) => e.user_id === where.user_id);
        if (where.status) list = list.filter((e) => e.status === where.status);
        return Promise.resolve(list.length);
      }),
      findMany: vi.fn().mockImplementation(({ where, skip = 0, take = 20 }) => {
        let list = mockEmailsDb.filter((e) => e.user_id === where.user_id);
        if (where.status) list = list.filter((e) => e.status === where.status);
        if (where.OR) {
          list = list.filter(
            (e) =>
              e.subject.toLowerCase().includes('pitch') ||
              e.recipient.toLowerCase().includes('sequoia')
          );
        }
        return Promise.resolve(list.slice(skip, skip + take));
      }),
    },
  };

  beforeEach(() => {
    vi.spyOn(prismaModule, 'getPrisma').mockReturnValue(mockPrisma);
  });

  it('searches emails by recipient with strict tenant isolation', async () => {
    // User A searches for "sequoia"
    const resA = await request(app)
      .get('/api/emails/search?q=sequoia')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resA.status).toBe(200);
    expect(resA.body.items).toHaveLength(1);
    expect(resA.body.items[0].recipient).toBe('investor@sequoia.com');
    expect(resA.body.items[0].subject).toBe('Series A Pitch Deck');

    // User B searches for "sequoia" -> sees User B's confidential email, NEVER User A's!
    const resB = await request(app)
      .get('/api/emails/search?q=sequoia')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(resB.status).toBe(200);
    expect(resB.body.items).toHaveLength(1);
    expect(resB.body.items[0].subject).toBe('User B Confidential Proposal');
  });

  it('filters search results by status parameter', async () => {
    const resScheduled = await request(app)
      .get('/api/emails/search?status=scheduled')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resScheduled.status).toBe(200);
    expect(resScheduled.body.items).toHaveLength(1);
    expect(resScheduled.body.items[0].recipient).toBe('partner@andreessen.com');
  });
});
