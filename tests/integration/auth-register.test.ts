import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { POST as registerRoute } from '../../app/api/auth/register/route';
import { buildRequest, readJson, getResponseCookie } from '../helpers/request';
import { testDb, truncateAll } from '../helpers/db';
import { COOKIE } from '@/lib/config';

const path = '/api/auth/register';

async function register(body: unknown) {
  return registerRoute(buildRequest({ method: 'POST', path, body }), { params: {} });
}

describe('POST /api/auth/register', () => {
  beforeEach(truncateAll);
  afterAll(() => testDb.$disconnect());

  it('registers a customer, returns 201, sets auth cookies, stores a hashed password', async () => {
    const res = await register({
      email: 'New.User@Example.com',
      password: 'Password123!',
      fullName: 'New User',
      role: 'CUSTOMER',
    });
    expect(res.status).toBe(201);

    const body = await readJson(res);
    expect(body.data.user.role).toBe('CUSTOMER');
    // Email normalised to lowercase.
    expect(body.data.user.email).toBe('new.user@example.com');
    // No sensitive fields leak.
    expect(body.data.user.passwordHash).toBeUndefined();

    // Auth cookies present.
    expect(getResponseCookie(res, COOKIE.ACCESS_TOKEN)).toBeTruthy();
    expect(getResponseCookie(res, COOKIE.REFRESH_TOKEN)).toBeTruthy();

    // Password persisted as an argon2id hash, never plaintext.
    const stored = await testDb.user.findUnique({ where: { email: 'new.user@example.com' } });
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored?.passwordHash).not.toContain('Password123!');
  });

  it('allows registering as ORGANISER', async () => {
    const res = await register({
      email: 'org@example.com',
      password: 'Password123!',
      fullName: 'Org User',
      role: 'ORGANISER',
    });
    expect(res.status).toBe(201);
    expect((await readJson(res)).data.user.role).toBe('ORGANISER');
  });

  it('rejects duplicate email with 409 EMAIL_TAKEN', async () => {
    await register({ email: 'dupe@example.com', password: 'Password123!', fullName: 'A' });
    const res = await register({
      email: 'dupe@example.com',
      password: 'Password123!',
      fullName: 'B',
    });
    expect(res.status).toBe(409);
    expect((await readJson(res)).error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects a too-short password with 400 VALIDATION_ERROR', async () => {
    const res = await register({ email: 'weak@example.com', password: 'short', fullName: 'A' });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe('VALIDATION_ERROR');
  });

  it('forbids self-registering as ADMIN (validation rejects the role)', async () => {
    const res = await register({
      email: 'sneaky@example.com',
      password: 'Password123!',
      fullName: 'Sneaky',
      role: 'ADMIN',
    });
    expect(res.status).toBe(400);
    // And no admin was created.
    expect(await testDb.user.count({ where: { role: 'ADMIN' } })).toBe(0);
  });

  it('rejects a malformed email with 400', async () => {
    const res = await register({ email: 'not-an-email', password: 'Password123!', fullName: 'A' });
    expect(res.status).toBe(400);
  });
});
