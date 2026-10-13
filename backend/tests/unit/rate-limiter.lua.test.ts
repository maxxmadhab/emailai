import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RateLimiterService } from '../../src/services/rate-limiter.service.js';
import * as redisModule from '../../src/lib/redis.js';

describe('Redis Lua Rate Limiter & Concurrency Admission', () => {
  const rateLimiter = new RateLimiterService();

  // In-memory Redis simulation of the Lua script logic
  const redisStore: Map<string, { value: string; expiresAt?: number }> = new Map();

  const mockRedis: any = {
    eval: vi.fn().mockImplementation((_script, _numKeys, key1, key2, key3, nowMs, limit, minDelay, windowEnd, windowTtl) => {
      const now = Number(nowMs);
      const limitNum = Number(limit);
      const minDelayNum = Number(minDelay);
      const windowEndNum = Number(windowEnd);

      const getVal = (k: string) => {
        const item = redisStore.get(k);
        if (!item) return null;
        if (item.expiresAt && item.expiresAt <= now) {
          redisStore.delete(k);
          return null;
        }
        return item.value;
      };

      const setVal = (k: string, v: string, ttlMs?: number) => {
        redisStore.set(k, { value: v, expiresAt: ttlMs ? now + ttlMs : undefined });
      };

      const currentCount = Number(getVal(key1) || '0');

      // 1. Quota check
      if (currentCount >= limitNum) {
        const alerted = getVal(key3);
        let shouldAlert = 0;
        if (!alerted) {
          setVal(key3, '1', Number(windowTtl));
          shouldAlert = 1;
        }

        const nextSlot = Number(getVal(key2) || '0');
        let retryAt = windowEndNum;
        if (nextSlot > windowEndNum) {
          retryAt = nextSlot;
        }
        setVal(key2, String(retryAt + minDelayNum), Number(windowTtl) * 2);

        return ['LIMIT_EXCEEDED', String(retryAt), currentCount, shouldAlert];
      }

      // 2. Spacing check
      const nextAvailable = Number(getVal(key2) || '0');
      if (now < nextAvailable) {
        return ['SPACING_VIOLATION', String(nextAvailable), currentCount, 0];
      }

      // 3. Admission GRANTED
      const newCount = currentCount + 1;
      setVal(key1, String(newCount), Number(windowTtl));
      const nextSlot = now + minDelayNum;
      setVal(key2, String(nextSlot), Number(windowTtl));

      return ['GRANTED', String(nextSlot), newCount, 0];
    }),
    keys: vi.fn().mockImplementation((pattern: string) => {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return Promise.resolve(Array.from(redisStore.keys()).filter((k) => regex.test(k)));
    }),
    del: vi.fn().mockImplementation((...keys: string[]) => {
      keys.forEach((k) => redisStore.delete(k));
      return Promise.resolve(keys.length);
    }),
  };

  beforeEach(() => {
    redisStore.clear();
    vi.spyOn(redisModule, 'getRedis').mockReturnValue(mockRedis);
  });

  it('admits first request and enforces min-delay spacing on subsequent immediate request', async () => {
    const senderId = 'sender-lua-1';
    const baseTime = 1770000000000; // Fixed timestamp

    // First request: admitted
    const res1 = await rateLimiter.requestAdmission(senderId, {
      hourlyLimit: 5,
      minDelaySeconds: 2,
      now: baseTime,
    });

    expect(res1.decision).toBe('GRANTED');
    expect(res1.currentCount).toBe(1);
    expect(res1.shouldAlert).toBe(false);

    // Second request 500ms later: spacing violation
    const res2 = await rateLimiter.requestAdmission(senderId, {
      hourlyLimit: 5,
      minDelaySeconds: 2,
      now: baseTime + 500, // Only 0.5s later, 2s required
    });

    expect(res2.decision).toBe('SPACING_VIOLATION');
    expect(res2.retryAtMs).toBe(baseTime + 2000);

    // Third request after 2.1s: admitted
    const res3 = await rateLimiter.requestAdmission(senderId, {
      hourlyLimit: 5,
      minDelaySeconds: 2,
      now: baseTime + 2100,
    });

    expect(res3.decision).toBe('GRANTED');
    expect(res3.currentCount).toBe(2);
  });

  it('guarantees multi-sender independence: sender A quota does not affect sender B', async () => {
    const senderA = 'sender-A';
    const senderB = 'sender-B';
    const now = 1770000000000;

    const resA = await rateLimiter.requestAdmission(senderA, {
      hourlyLimit: 2,
      minDelaySeconds: 1,
      now,
    });

    const resB = await rateLimiter.requestAdmission(senderB, {
      hourlyLimit: 2,
      minDelaySeconds: 1,
      now,
    });

    expect(resA.decision).toBe('GRANTED');
    expect(resA.currentCount).toBe(1);

    expect(resB.decision).toBe('GRANTED');
    expect(resB.currentCount).toBe(1);
  });

  it('strictly caps admissions at exact limit and emits shouldAlert exactly ONCE across 500 over-limit requests', async () => {
    const senderId = 'sender-overlimit';
    const hourlyLimit = 5;
    const baseTime = 1770000000000;

    let grantedCount = 0;
    let limitExceededCount = 0;
    let totalAlerts = 0;

    // Fill up quota of 5 (spaced by 2s)
    for (let i = 0; i < hourlyLimit; i++) {
      const res = await rateLimiter.requestAdmission(senderId, {
        hourlyLimit,
        minDelaySeconds: 2,
        now: baseTime + i * 2000,
      });
      if (res.decision === 'GRANTED') grantedCount++;
    }

    expect(grantedCount).toBe(5);

    // Bombard with 500 requests at same time: all must be LIMIT_EXCEEDED, exactly 1 alert
    const parallelRequests = [];
    for (let j = 0; j < 500; j++) {
      parallelRequests.push(
        rateLimiter.requestAdmission(senderId, {
          hourlyLimit,
          minDelaySeconds: 2,
          now: baseTime + 15000 + j,
        })
      );
    }

    const results = await Promise.all(parallelRequests);
    for (const res of results) {
      if (res.decision === 'LIMIT_EXCEEDED') limitExceededCount++;
      if (res.shouldAlert) totalAlerts++;
    }

    expect(limitExceededCount).toBe(500);
    // CRITICAL: Exactly ONE Slack notification event triggered for this entire over-limit window!
    expect(totalAlerts).toBe(1);
  });

  it('handles UTC hour rollover boundary: resets quota at next hour window', async () => {
    const senderId = 'sender-rollover';
    const hourStart = 1770000000000; // e.g. 10:00:00
    const nextHour = hourStart + 3600000; // 11:00:00

    // Exhaust quota in hour 1
    const res1 = await rateLimiter.requestAdmission(senderId, {
      hourlyLimit: 1,
      minDelaySeconds: 0,
      now: hourStart,
    });
    expect(res1.decision).toBe('GRANTED');

    const res2 = await rateLimiter.requestAdmission(senderId, {
      hourlyLimit: 1,
      minDelaySeconds: 0,
      now: hourStart + 1000,
    });
    expect(res2.decision).toBe('LIMIT_EXCEEDED');

    // Cross into next UTC hour window
    const res3 = await rateLimiter.requestAdmission(senderId, {
      hourlyLimit: 1,
      minDelaySeconds: 0,
      now: nextHour + 1,
    });

    expect(res3.decision).toBe('GRANTED');
    expect(res3.currentCount).toBe(1);
  });
});
