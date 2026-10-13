import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { mintTestToken } from '../../src/lib/jwt.js';

describe('Admin BullMQ Dashboard Protection', () => {
  const app = createApp();

  const adminUser = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    email: 'admin@reachinbox.ai',
  };
  const validToken = mintTestToken(adminUser);

  it('rejects unauthenticated requests to /admin/queues with 401 UNAUTHORIZED_ADMIN', async () => {
    const res = await request(app).get('/admin/queues');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED_ADMIN');
  });

  it('rejects malformed bearer token with 401', async () => {
    const res = await request(app)
      .get('/admin/queues')
      .set('Authorization', 'Bearer invalid.jwt.token');

    expect(res.status).toBe(401);
  });

  it('permits authenticated requests with valid Bearer token', async () => {
    const res = await request(app)
      .get('/admin/queues')
      .set('Authorization', `Bearer ${validToken}`);

    // Bull-board redirects or serves HTML dashboard
    expect([200, 301, 302]).toContain(res.status);
  });
});
