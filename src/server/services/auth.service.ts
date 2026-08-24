import type { User } from '@prisma/client';
import { env } from '@/env';
import { Errors } from '@/lib/errors';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { signAccessToken } from '@/server/auth/jwt';
import { generateRefreshToken, hashRefreshToken } from '@/server/auth/tokens';
import {
  userRepository,
  toPublicUser,
  type PublicUser,
} from '@/server/repositories/user.repository';
import { refreshTokenRepository } from '@/server/repositories/refresh-token.repository';
import type { RegisterInput, LoginInput } from '@/server/validation/auth.schema';

/**
 * Authentication business logic. Returns issued tokens and a public user; the
 * HTTP layer is responsible for placing tokens into httpOnly cookies. No
 * Prisma/HTTP details leak into or out of this module.
 */

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

// A fixed argon2 hash of a random value, used to equalise login timing when the
// email does not exist (mitigates user-enumeration via response time).
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZS1zYWx0LXZhbHVl$3Vx8m3H1o5F2h0e0d1a2b3c4d5e6f7g8h9i0j1k2l3m';

async function issueTokens(user: User): Promise<AuthResult> {
  const accessToken = await signAccessToken({ sub: user.id, role: user.role });
  const { raw, hash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env().REFRESH_TOKEN_TTL_SECONDS * 1000);
  await refreshTokenRepository.create({ userId: user.id, tokenHash: hash, expiresAt });
  return { user: toPublicUser(user), accessToken, refreshToken: raw };
}

export const authService = {
  async register(input: RegisterInput): Promise<AuthResult> {
    const existing = await userRepository.findByEmail(input.email);
    if (existing) {
      throw Errors.emailTaken();
    }
    const passwordHash = await hashPassword(input.password);
    const user = await userRepository.create({
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      role: input.role,
    });
    return issueTokens(user);
  },

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await userRepository.findByEmail(input.email);
    if (!user) {
      // Still perform a verify against a dummy hash to keep timing uniform.
      await verifyPassword(DUMMY_HASH, input.password);
      throw Errors.invalidCredentials();
    }
    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) {
      throw Errors.invalidCredentials();
    }
    return issueTokens(user);
  },

  /**
   * Rotate a refresh token: verify it is live, revoke it, and issue a fresh
   * access+refresh pair. Reusing a revoked/expired token yields 401.
   */
  async refresh(rawRefreshToken: string): Promise<AuthResult> {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const stored = await refreshTokenRepository.findValidByHash(tokenHash);
    if (!stored) {
      throw Errors.unauthenticated('Invalid or expired session');
    }
    const user = await userRepository.findById(stored.userId);
    if (!user) {
      throw Errors.unauthenticated('Invalid or expired session');
    }
    const result = await issueTokens(user);
    // Revoke the old token and link it to the replacement (rotation trail).
    const replacementHash = hashRefreshToken(result.refreshToken);
    const replacement = await refreshTokenRepository.findValidByHash(replacementHash);
    await refreshTokenRepository.revoke(stored.id, replacement?.id);
    return result;
  },

  /** Revoke the presented refresh token (best-effort; logout is idempotent). */
  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const stored = await refreshTokenRepository.findValidByHash(tokenHash);
    if (stored) {
      await refreshTokenRepository.revoke(stored.id);
    }
  },
};
