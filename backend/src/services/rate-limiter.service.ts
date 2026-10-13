import { getRedis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

export interface AdmissionResult {
  decision: 'GRANTED' | 'SPACING_VIOLATION' | 'LIMIT_EXCEEDED';
  retryAtMs?: number;
  currentCount: number;
  hourlyLimit: number;
  shouldAlert: boolean;
  windowStartMs: number;
  windowEndMs: number;
}

const ADMISSION_LUA_SCRIPT = `
-- KEYS[1]: sender_hourly_key = "sender:{senderId}:window:{windowStart}"
-- KEYS[2]: sender_slot_key   = "sender:{senderId}:next_slot"
-- KEYS[3]: sender_alert_key  = "sender:{senderId}:alert:{windowStart}"

-- ARGV[1]: nowMs
-- ARGV[2]: hourlyLimit
-- ARGV[3]: minDelayMs
-- ARGV[4]: windowEndMs
-- ARGV[5]: windowTtlMs

local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local minDelay = tonumber(ARGV[3])
local windowEnd = tonumber(ARGV[4])
local windowTtl = tonumber(ARGV[5])

local currentCount = tonumber(redis.call('get', KEYS[1]) or '0')

-- 1. Check hourly quota
if currentCount >= limit then
  local alerted = redis.call('get', KEYS[3])
  local shouldAlert = 0
  if not alerted then
    redis.call('set', KEYS[3], '1', 'PX', windowTtl)
    shouldAlert = 1
  end

  -- Calculate slot in the next hour window
  local nextSlot = tonumber(redis.call('get', KEYS[2]) or '0')
  local retryAt = windowEnd
  if nextSlot > windowEnd then
    retryAt = nextSlot
  end
  -- Reserve next slot in next window so rescheduled jobs remain spaced
  redis.call('set', KEYS[2], retryAt + minDelay, 'PX', windowTtl * 2)

  return {'LIMIT_EXCEEDED', tostring(retryAt), currentCount, shouldAlert}
end

-- 2. Check min delay between sends
local nextAvailable = tonumber(redis.call('get', KEYS[2]) or '0')
if now < nextAvailable then
  return {'SPACING_VIOLATION', tostring(nextAvailable), currentCount, 0}
end

-- 3. Admission GRANTED
local newCount = redis.call('incr', KEYS[1])
if newCount == 1 then
  redis.call('pexpire', KEYS[1], windowTtl)
end

local nextSlot = now + minDelay
redis.call('set', KEYS[2], tostring(nextSlot), 'PX', windowTtl)

return {'GRANTED', tostring(nextSlot), newCount, 0}
`;

export class RateLimiterService {
  /**
   * Atomically evaluates admission for a sender send operation via Redis Lua script.
   * Concurrency-safe across arbitrary worker processes.
   */
  async requestAdmission(
    senderId: string,
    options: {
      hourlyLimit: number;
      minDelaySeconds: number;
      now?: number;
    }
  ): Promise<AdmissionResult> {
    const redis = getRedis();
    const now = options.now ?? Date.now();
    const minDelayMs = Math.max(0, options.minDelaySeconds * 1000);

    // Fixed UTC Hourly Window
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const windowStartMs = Math.floor(now / ONE_HOUR_MS) * ONE_HOUR_MS;
    const windowEndMs = windowStartMs + ONE_HOUR_MS;
    const windowTtlMs = 2 * ONE_HOUR_MS; // 2 hours TTL for safety

    const hourlyKey = `sender:${senderId}:window:${windowStartMs}`;
    const slotKey = `sender:${senderId}:next_slot`;
    const alertKey = `sender:${senderId}:alert:${windowStartMs}`;

    try {
      const rawResult = (await redis.eval(
        ADMISSION_LUA_SCRIPT,
        3,
        hourlyKey,
        slotKey,
        alertKey,
        now,
        options.hourlyLimit,
        minDelayMs,
        windowEndMs,
        windowTtlMs
      )) as [string, string, number, number];

      const [decision, retryAtStr, count, alertInt] = rawResult;
      const retryAtMs = retryAtStr ? parseInt(retryAtStr, 10) : undefined;
      const currentCount = Number(count);
      const shouldAlert = alertInt === 1;

      return {
        decision: decision as 'GRANTED' | 'SPACING_VIOLATION' | 'LIMIT_EXCEEDED',
        retryAtMs,
        currentCount,
        hourlyLimit: options.hourlyLimit,
        shouldAlert,
        windowStartMs,
        windowEndMs,
      };
    } catch (err: any) {
      if (
        err.message &&
        (err.message.includes('Connection is closed') ||
          err.message.includes('ECONNREFUSED') ||
          err.message.includes('offline'))
      ) {
        logger.warn({ senderId }, 'Redis unreachable for rate limiter; granting resilient fallback admission');
        return {
          decision: 'GRANTED',
          currentCount: 1,
          hourlyLimit: options.hourlyLimit,
          shouldAlert: false,
          windowStartMs,
          windowEndMs,
        };
      }
      logger.error({ err, senderId }, 'Error evaluating rate limiter Lua script');
      throw err;
    }
  }

  /**
   * Resets rate limiting state for a sender (primarily for testing and administration)
   */
  async resetSender(senderId: string): Promise<void> {
    const redis = getRedis();
    const keys = await redis.keys(`sender:${senderId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
}

export const rateLimiterService = new RateLimiterService();
