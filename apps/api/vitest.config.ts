import { defineConfig } from 'vitest/config';

// Tests run against a REAL PostgreSQL database (payment_recon_test).
// Create it once: createdb payment_recon_test   (or use psql)
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false, // test files share one database
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/payment_recon_test',
      JWT_SECRET: 'test-jwt-secret-that-is-at-least-32-chars',
      WEBHOOK_SECRET: 'test-webhook-secret-that-is-at-least-32-chars',
      WEB_ORIGIN: 'http://localhost:5173',
    },
  },
});
