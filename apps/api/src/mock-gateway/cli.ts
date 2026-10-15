import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@payment-recon/shared';
import { signatureHeader } from '../modules/webhooks/signature';
import { makeEvent } from './events';

// Development tool only. It is a CLI, never an endpoint the public can call.
// Usage: npm run gateway -- --payments 3 --url http://localhost:4000/api/webhooks/mock-gateway

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const url = arg('url', 'http://localhost:4000/api/webhooks/mock-gateway');
const merchant = arg('merchant', 'merchant_demo');
const count = Number(arg('payments', '3'));
const secret = process.env.WEBHOOK_SECRET;
if (!secret) {
  console.error('WEBHOOK_SECRET is not set. Put it in apps/api/.env or export it.');
  process.exit(1);
}

async function send(label: string, envelope: EventEnvelope, rawBody = JSON.stringify(envelope)): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-gateway-signature': signatureHeader(secret!, rawBody),
    },
    body: rawBody,
  });
  console.log(`${label.padEnd(26)} ${envelope.type.padEnd(18)} ${envelope.id} -> HTTP ${res.status} ${await res.text()}`);
  return rawBody;
}

async function main() {
  console.log(`Sending ${count} payment(s) to ${url}\n`);
  for (let i = 1; i <= count; i++) {
    const paymentId = `pay_${randomUUID().slice(0, 8)}`;
    const amount = 4990 * i;
    const created = makeEvent('payment.created', paymentId, merchant, amount, 'INR');
    const succeeded = makeEvent('payment.succeeded', paymentId, merchant, amount, 'INR');

    if (count > 1 && i === count) {
      // Out of order: the success arrives before the payment exists. It gets FAILED and is retried.
      await send('out-of-order success', succeeded);
      await send('late create', created);
      console.log('  (the out-of-order success will be applied by the retry worker after its backoff)\n');
      continue;
    }

    const createdBody = await send('payment created', created);
    await send('payment succeeded', succeeded);

    if (i === 1) {
      // Exact duplicate: the same bytes, delivered again, as a gateway retry would.
      await send('DUPLICATE (gateway retry)', created, createdBody);
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
