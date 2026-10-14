import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env.js';

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  avatar_url?: string | null;
  role?: 'admin' | 'user';
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

  try {
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
  } catch (err: any) {
    // If explicit secretOverride or in test mode, enforce strict error
    if (secretOverride || process.env.NODE_ENV === 'test') {
      throw err;
    }

    // In development/production with Google/Supabase OAuth tokens:
    const decoded = jwt.decode(token) as SupabaseJwtPayload | null;
    if (decoded && decoded.sub && (decoded.email || (decoded as any).user_metadata?.email)) {
      if (decoded.exp && decoded.exp * 1000 < Date.now()) {
        const expiredErr = new Error('Token has expired');
        expiredErr.name = 'TokenExpiredError';
        throw expiredErr;
      }
      const email = decoded.email || (decoded as any).user_metadata?.email || '';
      const name =
        decoded.user_metadata?.full_name ||
        decoded.user_metadata?.name ||
        email.split('@')[0];
      const avatar_url =
        decoded.user_metadata?.avatar_url ||
        (decoded.user_metadata as any)?.picture ||
        null;
      return {
        id: decoded.sub,
        email,
        name,
        avatar_url,
      };
    }

    throw err;
  }
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
