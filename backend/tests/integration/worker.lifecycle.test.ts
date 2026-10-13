import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailWorker } from '../../src/worker/email.worker.js';
import { outboxDispatcherService } from '../../src/services/outbox-dispatcher.service.js';
import * as prismaModule from '../../src/lib/prisma.js';
import * as queueModule from '../../src/queue/email.queue.js';

describe('Worker Lifecycle & Concurrency Safety', () => {
  const emailWorker = new EmailWorker();

  const emailId = 'email-race-test-uuid-0001';
  let emailRecord: any;
  const outboxEvents: any[] = [];

  const mockPrisma: any = {
    email: {
      updateMany: vi.fn().mockImplementation(({ where, data }) => {
        if (emailRecord.id === where.id && emailRecord.status === where.status) {
          Object.assign(emailRecord, {
            status: data.status,
            attempts: (emailRecord.attempts || 0) + 1,
          });
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 }); // Loser of race gets 0 rows
      }),
      findUnique: vi.fn().mockImplementation(() => Promise.resolve(emailRecord)),
      update: vi.fn().mockImplementation(({ data }) => {
        Object.assign(emailRecord, data);
        return Promise.resolve(emailRecord);
      }),
    },
    sender: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'sender-1',
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        encrypted_username: 'iv:tag:user',
        encrypted_password: 'iv:tag:pass',
        hourly_limit: 50,
      }),
    },
    outboxEvent: {
      create: vi.fn().mockImplementation(({ data }) => {
        outboxEvents.push(data);
        return Promise.resolve(data);
      }),
      findMany: vi.fn().mockImplementation(({ where }) => {
        return Promise.resolve(outboxEvents.filter((e) => e.status === where.status));
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        const ev = outboxEvents.find((e) => e.id === where.id);
        if (ev) Object.assign(ev, data);
        return Promise.resolve(ev);
      }),
    },
  };

  beforeEach(() => {
    emailRecord = {
      id: emailId,
      user_id: 'user-1',
      sender_id: 'sender-1',
      recipient: 'race@example.com',
      subject: 'Race Condition Test',
      body: 'Test Body',
      status: 'scheduled',
      attempts: 0,
      scheduled_at: new Date(),
    };
    outboxEvents.length = 0;
    vi.spyOn(prismaModule, 'getPrisma').mockReturnValue(mockPrisma);
  });

  it('guarantees conditional claim: when 2 workers race on the same email, exactly one claims and loser skips', async () => {
    // Stub transporter sendMail for worker 1
    (emailWorker as any).getPooledTransporter = vi.fn().mockResolvedValue({
      sendMail: vi.fn().mockResolvedValue({
        messageId: '<msg-123@reachinbox.mail>',
      }),
    });

    const mockJob1: any = {
      id: `email:${emailId}`,
      data: { emailId, senderId: 'sender-1', recipient: 'race@example.com' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    const mockJob2: any = {
      id: `email:${emailId}`,
      data: { emailId, senderId: 'sender-1', recipient: 'race@example.com' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    // Both workers run processEmailJob concurrently
    const [result1, result2] = await Promise.all([
      emailWorker.processEmailJob(mockJob1),
      emailWorker.processEmailJob(mockJob2),
    ]);

    // One must succeed, the other must skip because the row was already claimed
    const successful = [result1, result2].filter((r: any) => r.success === true);
    const skipped = [result1, result2].filter((r: any) => r.skipped === true);

    expect(successful).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toBe('Already claimed or cancelled');
    expect(emailRecord.status).toBe('sent');
    expect(emailRecord.attempts).toBe(1);
  });

  it('startup outbox recovery: enqueues unpublished events from previous interrupted run', async () => {
    outboxEvents.push({
      id: 'outbox-unpub-1',
      event_type: 'EMAIL_SCHEDULED',
      status: 'pending',
      payload: {
        emailId: 'recovered-email-1',
        scheduledAt: new Date(Date.now() + 5000).toISOString(),
        recipient: 'recovered@example.com',
      },
    });

    const enqueueSpy = vi
      .spyOn(queueModule, 'enqueueEmailJob')
      .mockResolvedValue({ id: 'job-recovered' } as any);

    const recoveredCount = await outboxDispatcherService.reconcileStartupOutbox();

    expect(recoveredCount).toBe(1);
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({ emailId: 'recovered-email-1' }),
      expect.any(Number)
    );
    expect(outboxEvents[0].status).toBe('published');
  });

  it('handles permanent failure by transitioning email to failed without infinite retries', async () => {
    (emailWorker as any).getPooledTransporter = vi.fn().mockResolvedValue({
      sendMail: vi.fn().mockRejectedValue({
        code: 'EENVELOPE',
        responseCode: 550, // Permanent 5xx rejection
        message: '550 Recipient address rejected: User unknown',
      }),
    });

    const mockJob: any = {
      id: `email:${emailId}`,
      data: { emailId, senderId: 'sender-1', recipient: 'invalid-user@example.com' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    const result = await emailWorker.processEmailJob(mockJob);

    expect(result.success).toBe(false);
    expect(emailRecord.status).toBe('failed');
    expect(emailRecord.error).toContain('Recipient address rejected');
  });
});
