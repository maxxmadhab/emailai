import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { mintTestToken } from '../../src/lib/jwt.js';
import { slackService } from '../../src/services/slack.service.js';
import * as prismaModule from '../../src/lib/prisma.js';

describe('Slack OAuth & Notification Decoupling', () => {
  const app = createApp();

  const user = { id: '88888888-8888-4888-8888-888888888888', email: 'slack.admin@example.com' };
  const token = mintTestToken(user);

  let connectionRecord: any = null;

  const mockPrisma: any = {
    user: {
      upsert: vi.fn().mockResolvedValue(user),
      findUnique: vi.fn().mockResolvedValue(user),
    },
    slackConnection: {
      findUnique: vi.fn().mockImplementation(({ where }) => {
        if (connectionRecord && connectionRecord.user_id === where.user_id) {
          return Promise.resolve(connectionRecord);
        }
        return Promise.resolve(null);
      }),
      upsert: vi.fn().mockImplementation(({ create }) => {
        connectionRecord = { id: 'conn-1', ...create };
        return Promise.resolve(connectionRecord);
      }),
      deleteMany: vi.fn().mockImplementation(({ where }) => {
        if (connectionRecord && connectionRecord.user_id === where.user_id) {
          connectionRecord = null;
        }
        return Promise.resolve({ count: 1 });
      }),
    },
  };

  beforeEach(() => {
    connectionRecord = null;
    vi.spyOn(prismaModule, 'getPrisma').mockReturnValue(mockPrisma);
  });

  it('generates valid cryptographic HMAC signed state and rejects tampered state', () => {
    const state = slackService.generateSignedState(user.id);
    expect(state).toBeDefined();

    // Valid state verification
    const verified = slackService.verifySignedState(state);
    expect(verified.valid).toBe(true);
    expect(verified.userId).toBe(user.id);

    // Tampered user ID in state
    const tamperedParts = state.split('.');
    tamperedParts[0] = '99999999-9999-4999-8999-999999999999';
    const tamperedState = tamperedParts.join('.');

    const tamperedResult = slackService.verifySignedState(tamperedState);
    expect(tamperedResult.valid).toBe(false);
    expect(tamperedResult.error).toContain('verification failed');

    // Expired timestamp
    const expiredTimestamp = Date.now() - 30 * 60 * 1000; // 30 mins ago
    const expiredPayload = `${user.id}:${expiredTimestamp}`;
    const expiredState = `${user.id}.${expiredTimestamp}.dummySig`;
    expect(slackService.verifySignedState(expiredState).valid).toBe(false);
  });

  it('GET /api/slack/connect redirects to Slack authorize URL with signed state', async () => {
    const res = await request(app)
      .get('/api/slack/connect')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(302);
    const redirectUrl = res.headers.location;
    expect(redirectUrl).toContain('https://slack.com/oauth/v2/authorize');
    expect(redirectUrl).toContain('state=');
  });

  it('GET /api/slack/connection returns connected: false when no integration exists', async () => {
    const res = await request(app)
      .get('/api/slack/connection')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.connected).toBe(false);
  });

  it('DELETE /api/slack/connection disconnects integration cleanly', async () => {
    connectionRecord = {
      user_id: user.id,
      team_id: 'T123',
      team_name: 'ReachInbox Team',
      status: 'active',
    };

    const res = await request(app)
      .delete('/api/slack/connection')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(connectionRecord).toBeNull();
  });

  it('sendRateLimitAlert handles unconnected Slack cleanly without throwing or crashing', async () => {
    const result = await slackService.sendRateLimitAlert({
      userId: user.id,
      senderId: 'sender-1',
      senderEmail: 'test@sender.com',
      hourlyLimit: 50,
      currentCount: 50,
      windowStart: '2026-10-14T02:00:00Z',
      windowEnd: '2026-10-14T03:00:00Z',
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('Slack not connected');
  });
});
