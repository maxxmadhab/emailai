import { describe, it, expect } from 'vitest';
import { verifySupabaseToken, mintTestToken } from '../../src/lib/jwt.js';

describe('Supabase JWT Verification & Minting', () => {
  const secret = 'super-secret-supabase-jwt-key-32chars';

  it('mints and verifies a valid token successfully in test environment', () => {
    const token = mintTestToken({
      id: 'e499d3cb-8c6e-4735-8ea5-6b5cf69a48be',
      email: 'alex@example.com',
      name: 'Alex Developer',
      secretOverride: secret,
    });

    const user = verifySupabaseToken(token, secret);
    expect(user.id).toBe('e499d3cb-8c6e-4735-8ea5-6b5cf69a48be');
    expect(user.email).toBe('alex@example.com');
    expect(user.name).toBe('Alex Developer');
  });

  it('rejects an expired token', () => {
    const expiredToken = mintTestToken({
      id: 'e499d3cb-8c6e-4735-8ea5-6b5cf69a48be',
      email: 'alex@example.com',
      expiresInSeconds: -10, // expired 10 seconds ago
      secretOverride: secret,
    });

    expect(() => verifySupabaseToken(expiredToken, secret)).toThrow();
  });

  it('rejects a token with invalid signature', () => {
    const token = mintTestToken({
      id: 'e499d3cb-8c6e-4735-8ea5-6b5cf69a48be',
      email: 'alex@example.com',
      secretOverride: secret,
    });

    expect(() => verifySupabaseToken(token, 'different-wrong-secret-key-32chars')).toThrow();
  });

  it('rejects a token with invalid audience', () => {
    const token = mintTestToken({
      id: 'e499d3cb-8c6e-4735-8ea5-6b5cf69a48be',
      email: 'alex@example.com',
      audience: 'wrong-audience',
      secretOverride: secret,
    });

    expect(() => verifySupabaseToken(token, secret)).toThrow('Invalid token audience');
  });
});
