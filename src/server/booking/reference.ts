import { randomBytes } from 'node:crypto';

/** Human-readable booking reference, e.g. "BK-7F3K9Q2M" (base32, no ambiguity). */
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export function generateReference(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += REF_ALPHABET[bytes[i]! % REF_ALPHABET.length];
  return `BK-${out}`;
}

/** Opaque, unguessable QR ticket token (never encodes PII). */
export function generateTicketToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Cryptographically-random access token for a waitlist offer link. */
export function generateAccessToken(): string {
  return randomBytes(24).toString('base64url');
}
