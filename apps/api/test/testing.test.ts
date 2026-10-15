import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/lib/db';
import { ADMIN, count, payment, resetDb, setupDb } from './helpers';

const app = createApp();

beforeAll(async () => {
  await setupDb();
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetDb();
});

describe('Payment Testing Dashboard API (/api/testing)', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).post('/api/testing/send').send({ paymentId: 'PAY101', amount: 500 });
    expect(res.status).toBe(401);
  });

  it('processes payment 1, ignores duplicate payment 2, and processes payment 3', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send(ADMIN).expect(200);

    // 1. Payment 1: PAY101, ₹500
    const res1 = await agent.post('/api/testing/send').send({
      paymentId: 'PAY101',
      amount: 500,
      currency: 'INR',
      eventType: 'full_flow',
    });
    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('PROCESSED');
    expect(res1.body.duplicate).toBe(false);
    expect(res1.body.databaseOutcome.paymentExists).toBe(true);
    expect(res1.body.databaseOutcome.payment.status).toBe('SUCCEEDED');

    // 2. Payment 2: PAY101, ₹500 (Duplicate)
    const res2 = await agent.post('/api/testing/send').send({
      paymentId: 'PAY101',
      amount: 500,
      currency: 'INR',
      eventType: 'payment.created',
    });
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('DUPLICATE');
    expect(res2.body.duplicate).toBe(true);
    expect(res2.body.duplicateType).toBe('PAYMENT_ALREADY_EXISTS');
    expect(res2.body.message).toContain('Duplicate payment ID (PAY101) rejected');

    // 3. Payment 3: PAY102, ₹300
    const res3 = await agent.post('/api/testing/send').send({
      paymentId: 'PAY102',
      amount: 300,
      currency: 'INR',
      eventType: 'full_flow',
    });
    expect(res3.status).toBe(200);
    expect(res3.body.status).toBe('PROCESSED');
    expect(res3.body.duplicate).toBe(false);

    // Verify DB consistency: exactly 2 payments in table, no duplicate record
    expect(await count('payments')).toBe(2);
    const pay101 = await payment('PAY101');
    const pay102 = await payment('PAY102');
    expect(pay101).toBeDefined();
    expect(pay102).toBeDefined();
    expect(pay101.amount_minor).toBe('50000');
    expect(pay102.amount_minor).toBe('30000');
  });

  it('rejects the same payment ID when sent with conflicting amounts', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send(ADMIN).expect(200);

    // Initial valid payment: PAY201 with ₹500
    const res1 = await agent.post('/api/testing/send').send({
      paymentId: 'PAY201',
      amount: 500,
      currency: 'INR',
      eventType: 'payment.created',
    });
    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('PENDING');

    // Conflicting payment: PAY201 with ₹750
    const res2 = await agent.post('/api/testing/send').send({
      paymentId: 'PAY201',
      amount: 750,
      currency: 'INR',
      eventType: 'payment.created',
    });
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('REJECTED');
    expect(res2.body.errorReason).toContain('payment.created conflicts with existing payment');

    // Database still holds the original ₹500 payment
    const stored = await payment('PAY201');
    expect(stored.amount_minor).toBe('50000');
    expect(await count('payments')).toBe(1);
  });

  it('executes batch requests sequentially or concurrently', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send(ADMIN).expect(200);

    // Batch with the user example: PAY101 (500), PAY101 duplicate (500), PAY102 (300)
    const batchRes = await agent.post('/api/testing/batch').send({
      requests: [
        { paymentId: 'PAY101', amount: 500, currency: 'INR', eventType: 'full_flow' },
        { paymentId: 'PAY101', amount: 500, currency: 'INR', eventType: 'payment.created' },
        { paymentId: 'PAY102', amount: 300, currency: 'INR', eventType: 'full_flow' },
      ],
      concurrent: false,
    });

    expect(batchRes.status).toBe(200);
    expect(batchRes.body.summary.total).toBe(3);
    expect(batchRes.body.summary.processed).toBe(2);
    expect(batchRes.body.summary.duplicates).toBe(1);
    expect(batchRes.body.results[0].status).toBe('PROCESSED');
    expect(batchRes.body.results[1].status).toBe('DUPLICATE');
    expect(batchRes.body.results[2].status).toBe('PROCESSED');

    expect(await count('payments')).toBe(2);
  });

  it('handles concurrent duplicate race condition safely with zero duplicate rows in DB', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send(ADMIN).expect(200);

    // 5 concurrent requests with identical payment ID
    const batchRes = await agent.post('/api/testing/batch').send({
      requests: Array.from({ length: 5 }, () => ({
        paymentId: 'PAY_RACE_CONCURRENT',
        amount: 1000,
        currency: 'INR',
        eventType: 'payment.created',
      })),
      concurrent: true,
    });

    expect(batchRes.status).toBe(200);
    expect(batchRes.body.results).toHaveLength(5);

    // DB must contain exactly 1 payment record
    expect(await count('payments')).toBe(1);
    const pay = await payment('PAY_RACE_CONCURRENT');
    expect(pay).toBeDefined();
    expect(pay.status).toBe('PENDING');
  });

  it('validates invalid inputs: negative amounts, missing ID, invalid currency', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send(ADMIN).expect(200);

    // Negative amount
    const neg = await agent.post('/api/testing/send').send({
      paymentId: 'PAY_NEG',
      amount: -500,
      currency: 'INR',
    });
    expect(neg.status).toBe(200);
    expect(neg.body.httpStatus).toBe(400);
    expect(neg.body.status).toBe('ERROR');
    expect(neg.body.errorReason).toContain('amountMinor');

    // Missing payment ID
    const missing = await agent.post('/api/testing/send').send({
      paymentId: '',
      amount: 100,
      currency: 'INR',
    });
    expect(missing.status).toBe(200);
    expect(missing.body.httpStatus).toBe(400);
    expect(missing.body.status).toBe('ERROR');

    // Invalid currency
    const badCurr = await agent.post('/api/testing/send').send({
      paymentId: 'PAY_BAD_CURR',
      amount: 100,
      currency: 'XYZ123',
    });
    expect(badCurr.status).toBe(200);
    expect(badCurr.body.httpStatus).toBe(400);
    expect(badCurr.body.status).toBe('ERROR');
    expect(badCurr.body.errorReason).toContain('currency');
  });

  it('simulates backend crash before commit and rolls back DB changes', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send(ADMIN).expect(200);

    const crashRes = await agent.post('/api/testing/send').send({
      paymentId: 'PAY_CRASH',
      amount: 700,
      currency: 'INR',
      eventType: 'payment.created',
      simulateCrash: true,
    });

    expect(crashRes.status).toBe(200);
    expect(crashRes.body.status).toBe('FAILED');
    expect(crashRes.body.httpStatus).toBe(202);
    expect(crashRes.body.errorReason).toContain('Simulated backend crash');

    // Payment must NOT exist in payments table
    expect(await payment('PAY_CRASH')).toBeUndefined();
    expect(crashRes.body.databaseOutcome.paymentExists).toBe(false);
  });

  it('resets merchant test data on demand', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send(ADMIN).expect(200);

    await agent.post('/api/testing/send').send({ paymentId: 'PAY_TEMP', amount: 500, currency: 'INR' });
    expect(await count('payments')).toBe(1);

    const resetRes = await agent.post('/api/testing/reset').send();
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);

    expect(await count('payments')).toBe(0);
  });
});
