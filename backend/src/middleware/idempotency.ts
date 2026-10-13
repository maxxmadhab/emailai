import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getPrisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

export function requireIdempotency(options: { expiryHours?: number } = {}) {
  const expiryHours = options.expiryHours ?? 24;

  return async (req: Request, res: Response, next: NextFunction) => {
    const rawKey = req.headers['idempotency-key'];
    if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
      return res.status(400).json({
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'The Idempotency-Key header is required for this endpoint',
        },
      });
    }

    const idempotencyKey = rawKey.trim();
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required before verifying idempotency',
        },
      });
    }

    // Compute deterministic SHA-256 hash of the request payload
    const bodyString = JSON.stringify(req.body || {});
    const requestHash = crypto.createHash('sha256').update(bodyString).digest('hex');

    const prisma = getPrisma();

    try {
      // Check if this key already exists for the user
      const existing = await prisma.idempotencyKey.findUnique({
        where: {
          user_id_key: {
            user_id: userId,
            key: idempotencyKey,
          },
        },
      });

      if (existing) {
        // Verify payload match
        if (existing.request_hash !== requestHash) {
          return res.status(422).json({
            error: {
              code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
              message: 'This Idempotency-Key was previously used with a different request payload',
            },
          });
        }

        // If previous request completed, return cached response
        if (existing.response_status !== null && existing.response_body !== null) {
          logger.info(
            { userId, idempotencyKey, statusCode: existing.response_status },
            'Returning cached idempotent response'
          );
          return res.status(existing.response_status).json(existing.response_body);
        }

        // If previous request is still in flight
        return res.status(409).json({
          error: {
            code: 'CONCURRENT_REQUEST',
            message: 'A request with this Idempotency-Key is currently in flight. Please retry shortly.',
          },
        });
      }

      // Create new pending idempotency record
      const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
      try {
        await prisma.idempotencyKey.create({
          data: {
            user_id: userId,
            key: idempotencyKey,
            request_hash: requestHash,
            expires_at: expiresAt,
          },
        });
      } catch (insertErr: any) {
        // Unique constraint race condition check
        if (insertErr?.code === 'P2002') {
          return res.status(409).json({
            error: {
              code: 'CONCURRENT_REQUEST',
              message: 'A request with this Idempotency-Key was just started by a concurrent call.',
            },
          });
        }
        throw insertErr;
      }

      // Intercept response to store status & body upon completion
      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        // Asynchronously save response to idempotency table
        prisma.idempotencyKey
          .update({
            where: {
              user_id_key: {
                user_id: userId,
                key: idempotencyKey,
              },
            },
            data: {
              response_status: res.statusCode,
              response_body: body,
            },
          })
          .catch((err) => {
            logger.error({ err, userId, idempotencyKey }, 'Failed to persist idempotency response');
          });

        return originalJson(body);
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}
