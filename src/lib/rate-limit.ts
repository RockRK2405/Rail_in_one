import type { NextRequest } from 'next/server';
import { Errors } from './errors';

/**
 * Best-effort in-process rate limiter (sliding window).
 *
 * Purpose: defence-in-depth against credential stuffing and holds/checkout
 * spam. In production behind Vercel this is per-function-instance and is
 * therefore best-effort; it materially raises the cost of a brute-force
 * attempt without pretending to be a distributed limiter. A future upgrade
 * path is a shared store (Upstash Redis / Vercel KV) — the call site would not
 * change.
 */

interface Window {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, Window>();

/**
 * `limit` requests per `windowMs`. Throws Errors.rateLimited when exceeded.
 * Keyed by a stable identifier (typically `${route}:${ip}`).
 */
export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return;
  }
  existing.count += 1;
  if (existing.count > limit) {
    throw Errors.rateLimited();
  }
}

/**
 * Derive the caller's IP from the standard forwarded headers. Falls back to
 * `'unknown'` (which shares a bucket — worst case: a couple of test runs
 * throttle each other, acceptable).
 */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? req.ip ?? 'unknown';
}

/** Clear all buckets — testing hook. */
export function _resetRateLimits(): void {
  buckets.clear();
}
