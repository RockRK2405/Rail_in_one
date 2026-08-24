import { describe, it, expect } from 'vitest';
import { signAccessToken, verifyAccessToken } from '@/server/auth/jwt';

describe('JWT access tokens', () => {
  it('signs and verifies a token, preserving claims', async () => {
    const token = await signAccessToken({ sub: 'user-123', role: 'CUSTOMER' });
    const claims = await verifyAccessToken(token);
    expect(claims).toEqual({ sub: 'user-123', role: 'CUSTOMER' });
  });

  it('returns null for a tampered token', async () => {
    const token = await signAccessToken({ sub: 'user-123', role: 'ADMIN' });
    const tampered = `${token}x`;
    expect(await verifyAccessToken(tampered)).toBeNull();
  });

  it('returns null for a garbage token', async () => {
    expect(await verifyAccessToken('not.a.jwt')).toBeNull();
  });

  it('carries the role claim used for RBAC', async () => {
    const token = await signAccessToken({ sub: 'u1', role: 'ORGANISER' });
    const claims = await verifyAccessToken(token);
    expect(claims?.role).toBe('ORGANISER');
  });
});
