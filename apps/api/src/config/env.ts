import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Neon CLI writes connection variables to the repository-root .env.local (or
// .env). The API runs from its workspace directory, so load those files here
// before the workspace-local .env. Runtime-provided variables still win.
dotenv.config({ path: path.resolve(__dirname, '../../../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: z.string().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  WEBHOOK_SECRET: z.string().min(32, 'WEBHOOK_SECRET must be at least 32 characters'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
});

// Fail fast with a clear message instead of crashing later with a confusing error.
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
