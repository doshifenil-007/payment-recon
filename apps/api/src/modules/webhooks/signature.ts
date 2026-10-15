import crypto from 'node:crypto';

/** How old a signed request may be before we reject it as a replay. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: 'MALFORMED' | 'EXPIRED' | 'MISMATCH' };

/** HMAC-SHA256 over "<timestamp>.<raw body>". */
export function signPayload(secret: string, rawBody: string, timestamp: number): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

/** Builds the header value: t=<unix seconds>,v1=<hex signature>. */
export function signatureHeader(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${signPayload(secret, rawBody, timestamp)}`;
}

export function verifySignature(opts: {
  secret: string;
  rawBody: string;
  header: string | undefined;
  nowSeconds?: number;
}): SignatureCheck {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(opts.header ?? '');
  if (!match) return { ok: false, reason: 'MALFORMED' };

  const timestamp = Number(match[1]);
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  // The timestamp stops replay of an old captured request.
  if (Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: 'EXPIRED' };

  const expected = Buffer.from(signPayload(opts.secret, opts.rawBody, timestamp), 'hex');
  const received = Buffer.from(match[2]!, 'hex');
  // timingSafeEqual throws on unequal lengths, so check lengths first.
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return { ok: false, reason: 'MISMATCH' };
  }
  return { ok: true };
}
