import { describe, it, expect } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

describe('Environment Variable Validation', () => {
  const validEnv = {
    PORT: '4000',
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/postgres',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_JWT_SECRET: 'super-secret-supabase-jwt-key-32chars',
    CREDENTIAL_ENCRYPTION_KEY:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    ELASTICSEARCH_NODE: 'http://localhost:9200',
    WORKER_CONCURRENCY: '5',
  };

  it('validates a correct environment configuration', () => {
    const parsed = validateEnv(validEnv);
    expect(parsed.PORT).toBe(4000);
    expect(parsed.NODE_ENV).toBe('test');
    expect(parsed.WORKER_CONCURRENCY).toBe(5);
  });

  it('fails when DATABASE_URL is missing', () => {
    const invalid = { ...validEnv, DATABASE_URL: '' };
    expect(() => validateEnv(invalid)).toThrow();
  });

  it('fails when CREDENTIAL_ENCRYPTION_KEY is not 64 hex characters', () => {
    const shortKey = { ...validEnv, CREDENTIAL_ENCRYPTION_KEY: 'too-short' };
    expect(() => validateEnv(shortKey)).toThrow('CREDENTIAL_ENCRYPTION_KEY must be exactly 64 hex characters');
  });

  it('fails when SUPABASE_JWT_SECRET is shorter than 16 characters', () => {
    const shortJwtSecret = { ...validEnv, SUPABASE_JWT_SECRET: 'short' };
    expect(() => validateEnv(shortJwtSecret)).toThrow('SUPABASE_JWT_SECRET must be at least 16 characters');
  });
});
