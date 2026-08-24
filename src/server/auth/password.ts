import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing using argon2id (memory-hard, current OWASP recommendation).
 *
 * @node-rs/argon2 ships prebuilt native bindings (no compile step) and manages a
 * per-hash random salt internally; the salt and parameters are embedded in the
 * returned encoded string, so nothing extra needs storing.
 */

// Parameters tuned for a good security/latency balance on modest hardware.
const ARGON2_OPTIONS = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(encodedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(encodedHash, plain);
  } catch {
    // A malformed hash should read as "does not match", never crash the request.
    return false;
  }
}
