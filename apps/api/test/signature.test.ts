import { describe, expect, it } from 'vitest';
import { signatureHeader, verifySignature } from '../src/modules/webhooks/signature';

const secret = process.env.WEBHOOK_SECRET!;
const body = '{"id":"evt_1"}';

describe('webhook signature', () => {
  it('accepts a correctly signed, fresh request', () => {
    const now = 1_700_000_000;
    const header = signatureHeader(secret, body, now);
    expect(verifySignature({ secret, rawBody: body, header, nowSeconds: now })).toEqual({ ok: true });
  });

  it('rejects a missing or malformed header', () => {
    expect(verifySignature({ secret, rawBody: body, header: undefined })).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(verifySignature({ secret, rawBody: body, header: 'garbage' })).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('rejects a body that was changed after signing', () => {
    const now = 1_700_000_000;
    const header = signatureHeader(secret, body, now);
    const result = verifySignature({ secret, rawBody: '{"id":"evt_2"}', header, nowSeconds: now });
    expect(result).toEqual({ ok: false, reason: 'MISMATCH' });
  });

  it('rejects a signature made with the wrong secret', () => {
    const now = 1_700_000_000;
    const header = signatureHeader('some-other-secret-that-is-long-enough-1234', body, now);
    expect(verifySignature({ secret, rawBody: body, header, nowSeconds: now })).toEqual({ ok: false, reason: 'MISMATCH' });
  });

  it('rejects a request older than the tolerance (replay protection)', () => {
    const signedAt = 1_700_000_000;
    const header = signatureHeader(secret, body, signedAt);
    const result = verifySignature({ secret, rawBody: body, header, nowSeconds: signedAt + 301 });
    expect(result).toEqual({ ok: false, reason: 'EXPIRED' });
  });
});
