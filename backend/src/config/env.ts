import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Supabase
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().min(16, 'SUPABASE_JWT_SECRET must be at least 16 characters'),

  // Encryption (32 bytes = 64 hex characters)
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .length(64, 'CREDENTIAL_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)'),

  // Redis
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // Elasticsearch
  ELASTICSEARCH_NODE: z.string().default('http://localhost:9200'),

  // Worker
  WORKER_CONCURRENCY: z.coerce.number().default(5),

  // Admin Role Bootstrap
  ADMIN_EMAILS: z.string().optional().default(''),

  // Slack (Optional in Phase 1 & 2, required in Phase 3)
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_REDIRECT_URI: z.string().optional(),

  // Frontend URL for callbacks
  FRONTEND_URL: z.string().default('https://emailai-tau.vercel.app'),
});

export type Env = z.infer<typeof envSchema>;

let parsedEnv: Env;

export function getEnv(): Env {
  if (parsedEnv) return parsedEnv;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.format();
    console.error('Invalid environment configuration:', JSON.stringify(formatted, null, 2));
    throw new Error('Environment validation failed');
  }

  parsedEnv = result.data;
  return parsedEnv;
}

export function validateEnv(customEnv?: Record<string, unknown>): Env {
  return envSchema.parse(customEnv ?? process.env);
}
