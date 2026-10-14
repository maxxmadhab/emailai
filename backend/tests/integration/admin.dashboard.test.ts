import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { mintTestToken } from '../../src/lib/jwt.js';
import * as prismaModule from '../../src/lib/prisma.js';

process.env.ADMIN_EMAILS = 'admin@reachinbox.ai';

describe('Admin BullMQ Dashboard Protection', () => {
  const app = createApp();

  const adminUser = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    email: 'admin@reachinbox.ai',
  };
  const regularUser = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    email: 'regular@reachinbox.ai',
  };

  const validAdminToken = mintTestToken(adminUser);
  const regularToken = mintTestToken(regularUser);

  const mockPrisma: any = {
    user: {
      findUnique: vi.fn().mockImplementation(({ where }) => {
        if (where.id === adminUser.id) {
          return Promise.resolve({ ...adminUser, role: 'admin' });
        }
        return Promise.resolve({ ...regularUser, role: 'user' });
      }),
      upsert: vi.fn().mockImplementation(({ create, where }) => {
        const isAdmin = where.id === adminUser.id;
        return Promise.resolve({ ...create, role: isAdmin ? 'admin' : 'user' });
      }),
      count: vi.fn().mockResolvedValue(2),
    },
  };

  beforeEach(() => {
    vi.spyOn(prismaModule, 'getPrisma').mockReturnValue(mockPrisma);
  });

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

  it('rejects non-admin authenticated users with 403 FORBIDDEN', async () => {
    const res = await request(app)
      .get('/admin/queues')
      .set('Authorization', `Bearer ${regularToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('permits authenticated requests with valid admin Bearer token', async () => {
    const res = await request(app)
      .get('/admin/queues')
      .set('Authorization', `Bearer ${validAdminToken}`);

    // Bull-board redirects or serves HTML dashboard
    expect([200, 301, 302]).toContain(res.status);
  });
});
