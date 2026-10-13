import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env.js';

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  avatar_url?: string | null;
}

export interface SupabaseJwtPayload {
  sub: string;
  email: string;
  aud?: string;
  role?: string;
  exp?: number;
  iat?: number;
  user_metadata?: {
    name?: string;
    full_name?: string;
    avatar_url?: string;
    [key: string]: unknown;
  };
}

/**
 * Verifies a Supabase JWT token.
 * Validates expiration, signature, and audience.
 */
export function verifySupabaseToken(token: string, secretOverride?: string): AuthUser {
  const secret = secretOverride || getEnv().SUPABASE_JWT_SECRET;

  const decoded = jwt.verify(token, secret, {
    algorithms: ['HS256'],
  }) as SupabaseJwtPayload;

  if (decoded.aud && decoded.aud !== 'authenticated') {
    throw new Error(`Invalid token audience: ${decoded.aud}`);
  }

  if (!decoded.sub || !decoded.email) {
    throw new Error('Token is missing required subject (sub) or email claim');
  }

  const name =
    decoded.user_metadata?.full_name ||
    decoded.user_metadata?.name ||
    decoded.email.split('@')[0];
  const avatar_url = decoded.user_metadata?.avatar_url || null;

  return {
    id: decoded.sub,
    email: decoded.email,
    name,
    avatar_url,
  };
}

/**
 * Test-only JWT minting helper for automated tests.
 * STRICTLY gated by NODE_ENV === 'test'.
 */
export function mintTestToken(options: {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
  expiresInSeconds?: number;
  audience?: string;
  secretOverride?: string;
}): string {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('mintTestToken is strictly restricted to test environment (NODE_ENV=test)');
  }

  const secret = options.secretOverride || getEnv().SUPABASE_JWT_SECRET;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (options.expiresInSeconds ?? 3600);

  const payload: SupabaseJwtPayload = {
    sub: options.id,
    email: options.email,
    aud: options.audience !== undefined ? options.audience : 'authenticated',
    role: 'authenticated',
    iat: now,
    exp,
    user_metadata: {
      full_name: options.name || 'Test User',
      name: options.name || 'Test User',
      avatar_url: options.avatar_url || 'https://lh3.googleusercontent.com/test',
    },
  };

  return jwt.sign(payload, secret, { algorithm: 'HS256' });
}
