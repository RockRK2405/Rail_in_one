import type { RefreshToken } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Data-access for refresh tokens. Tokens are stored only as SHA-256 hashes.
 * Supports issue, lookup, rotation (revoke + link replacement), and bulk revoke.
 */
export const refreshTokenRepository = {
  create(params: { userId: string; tokenHash: string; expiresAt: Date }): Promise<RefreshToken> {
    return prisma.refreshToken.create({ data: params });
  },

  findValidByHash(tokenHash: string): Promise<RefreshToken | null> {
    return prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  },

  revoke(id: string, replacedBy?: string): Promise<RefreshToken> {
    return prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date(), replacedBy: replacedBy ?? null },
    });
  },

  revokeAllForUser(userId: string): Promise<number> {
    return prisma.refreshToken
      .updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .then((r) => r.count);
  },
};
