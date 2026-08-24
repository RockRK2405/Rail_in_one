import { SignJWT, jwtVerify } from 'jose';
import type { UserRole } from '@prisma/client';
import { env } from '@/env';
import { JWT } from '@/lib/config';

/**
 * JWT access-token signing/verification using `jose` (Web Crypto based, works in
 * both Node and Edge runtimes). Access tokens are short-lived and stateless;
 * refresh tokens are opaque and stored hashed server-side (see tokens.ts).
 */

export interface AccessTokenClaims {
  sub: string; // user id
  role: UserRole;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env().JWT_SECRET);
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  const ttl = env().ACCESS_TOKEN_TTL_SECONDS;
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: JWT.ALG })
    .setSubject(claims.sub)
    .setIssuer(JWT.ISSUER)
    .setAudience(JWT.AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: JWT.ISSUER,
      audience: JWT.AUDIENCE,
      algorithms: [JWT.ALG],
    });
    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') {
      return null;
    }
    return { sub: payload.sub, role: payload.role as UserRole };
  } catch {
    // Expired/tampered/invalid token -> treat as unauthenticated.
    return null;
  }
}
