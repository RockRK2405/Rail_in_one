import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { POST as loginRoute } from '../../app/api/auth/login/route';
import { POST as logoutRoute } from '../../app/api/auth/logout/route';
import { POST as refreshRoute } from '../../app/api/auth/refresh/route';
import { GET as meRoute } from '../../app/api/auth/me/route';
import { buildRequest, readJson, authCookiesFrom, getResponseCookie } from '../helpers/request';
import { testDb, truncateAll } from '../helpers/db';
import { createUser } from '../helpers/auth';
import { COOKIE } from '@/lib/config';

const ctx = { params: {} };

describe('login / session lifecycle', () => {
  beforeEach(truncateAll);
  afterAll(() => testDb.$disconnect());

  it('logs in with correct credentials and sets auth cookies', async () => {
    const user = await createUser({
      role: 'CUSTOMER',
      email: 'c@example.com',
      password: 'Password123!',
    });
    const res = await loginRoute(
      buildRequest({
        method: 'POST',
        path: '/api/auth/login',
        body: { email: 'c@example.com', password: 'Password123!' },
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect((await readJson(res)).data.user.id).toBe(user.id);
    expect(getResponseCookie(res, COOKIE.ACCESS_TOKEN)).toBeTruthy();
  });

  it('rejects a wrong password with 401 INVALID_CREDENTIALS', async () => {
    await createUser({ role: 'CUSTOMER', email: 'c@example.com', password: 'Password123!' });
    const res = await loginRoute(
      buildRequest({
        method: 'POST',
        path: '/api/auth/login',
        body: { email: 'c@example.com', password: 'nope' },
      }),
      ctx,
    );
    expect(res.status).toBe(401);
    expect((await readJson(res)).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an unknown email with 401 (no user enumeration)', async () => {
    const res = await loginRoute(
      buildRequest({
        method: 'POST',
        path: '/api/auth/login',
        body: { email: 'ghost@example.com', password: 'whatever' },
      }),
      ctx,
    );
    expect(res.status).toBe(401);
    expect((await readJson(res)).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('GET /me returns the user when authenticated, 401 otherwise', async () => {
    const user = await createUser({
      role: 'CUSTOMER',
      email: 'c@example.com',
      password: 'Password123!',
    });
    const login = await loginRoute(
      buildRequest({
        method: 'POST',
        path: '/api/auth/login',
        body: { email: 'c@example.com', password: 'Password123!' },
      }),
      ctx,
    );
    const cookies = authCookiesFrom(login);

    const meOk = await meRoute(buildRequest({ path: '/api/auth/me', cookies }), ctx);
    expect(meOk.status).toBe(200);
    expect((await readJson(meOk)).data.user.id).toBe(user.id);

    const meAnon = await meRoute(buildRequest({ path: '/api/auth/me' }), ctx);
    expect(meAnon.status).toBe(401);
  });

  it('rotates the refresh token on refresh and issues a new access token', async () => {
    await createUser({ role: 'CUSTOMER', email: 'c@example.com', password: 'Password123!' });
    const login = await loginRoute(
      buildRequest({
        method: 'POST',
        path: '/api/auth/login',
        body: { email: 'c@example.com', password: 'Password123!' },
      }),
      ctx,
    );
    const cookies = authCookiesFrom(login);
    const originalRefresh = cookies[COOKIE.REFRESH_TOKEN];

    const refreshed = await refreshRoute(
      buildRequest({ method: 'POST', path: '/api/auth/refresh', cookies }),
      ctx,
    );
    expect(refreshed.status).toBe(200);
    const newRefresh = getResponseCookie(refreshed, COOKIE.REFRESH_TOKEN);
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toEqual(originalRefresh);

    // The old refresh token is now revoked -> reuse fails with 401.
    const reuse = await refreshRoute(
      buildRequest({
        method: 'POST',
        path: '/api/auth/refresh',
        cookies: { [COOKIE.REFRESH_TOKEN]: originalRefresh! },
      }),
      ctx,
    );
    expect(reuse.status).toBe(401);
  });

  it('logout revokes the refresh token so it can no longer be refreshed', async () => {
    await createUser({ role: 'CUSTOMER', email: 'c@example.com', password: 'Password123!' });
    const login = await loginRoute(
      buildRequest({
        method: 'POST',
        path: '/api/auth/login',
        body: { email: 'c@example.com', password: 'Password123!' },
      }),
      ctx,
    );
    const cookies = authCookiesFrom(login);

    const out = await logoutRoute(
      buildRequest({ method: 'POST', path: '/api/auth/logout', cookies }),
      ctx,
    );
    expect(out.status).toBe(200);

    const refresh = await refreshRoute(
      buildRequest({ method: 'POST', path: '/api/auth/refresh', cookies }),
      ctx,
    );
    expect(refresh.status).toBe(401);
  });
});
