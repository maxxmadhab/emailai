import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger.js';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) {
  // Log internal error with full stack trace server-side only
  logger.error(
    {
      err: {
        message: err.message,
        stack: err.stack,
        code: err.code,
      },
      path: req.path,
      method: req.method,
      user: req.user?.id,
    },
    'Request error'
  );

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      },
    });
  }

  const statusCode = err.statusCode || 500;
  const code = err.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST');
  const message = statusCode === 500 ? 'An internal server error occurred' : err.message;

  return res.status(statusCode).json({
    error: {
      code,
      message,
      ...(err.details ? { details: err.details } : {}),
    },
  });
}
