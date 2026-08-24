import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET as eventsGet, POST as eventsPost } from '../../app/api/events/route';
import { GET as organiserEventsGet } from '../../app/api/organiser/events/route';
import { GET as venuesGet, POST as venuesPost } from '../../app/api/admin/venues/route';
import { buildRequest, readJson } from '../helpers/request';
import { testDb, truncateAll } from '../helpers/db';
import { createUser, accessCookieFor } from '../helpers/auth';

const ctx = { params: {} };
const validEvent = { title: 'New Show', type: 'MOVIE' as const };
const validVenue = { name: 'Test Venue', city: 'Testville' };

describe('RBAC — server-side authorization matrix', () => {
  beforeEach(truncateAll);
  afterAll(() => testDb.$disconnect());

  describe('unauthenticated access to protected endpoints', () => {
    it('POST /api/events without auth -> 401', async () => {
      const res = await eventsPost(
        buildRequest({ method: 'POST', path: '/api/events', body: validEvent }),
        ctx,
      );
      expect(res.status).toBe(401);
      expect((await readJson(res)).error.code).toBe('UNAUTHENTICATED');
    });

    it('GET /api/organiser/events without auth -> 401', async () => {
      const res = await organiserEventsGet(buildRequest({ path: '/api/organiser/events' }), ctx);
      expect(res.status).toBe(401);
    });

    it('GET /api/admin/venues without auth -> 401', async () => {
      const res = await venuesGet(buildRequest({ path: '/api/admin/venues' }), ctx);
      expect(res.status).toBe(401);
    });
  });

  describe('customer is forbidden from organiser/admin actions', () => {
    it('customer POST /api/events -> 403', async () => {
      const customer = await createUser({ role: 'CUSTOMER' });
      const res = await eventsPost(
        buildRequest({
          method: 'POST',
          path: '/api/events',
          body: validEvent,
          cookies: await accessCookieFor(customer),
        }),
        ctx,
      );
      expect(res.status).toBe(403);
      expect((await readJson(res)).error.code).toBe('FORBIDDEN');
    });

    it('customer GET /api/organiser/events -> 403', async () => {
      const customer = await createUser({ role: 'CUSTOMER' });
      const res = await organiserEventsGet(
        buildRequest({ path: '/api/organiser/events', cookies: await accessCookieFor(customer) }),
        ctx,
      );
      expect(res.status).toBe(403);
    });

    it('customer POST /api/admin/venues -> 403', async () => {
      const customer = await createUser({ role: 'CUSTOMER' });
      const res = await venuesPost(
        buildRequest({
          method: 'POST',
          path: '/api/admin/venues',
          body: validVenue,
          cookies: await accessCookieFor(customer),
        }),
        ctx,
      );
      expect(res.status).toBe(403);
    });
  });

  describe('organiser authorization', () => {
    it('organiser POST /api/events -> 201 and owns the event', async () => {
      const organiser = await createUser({ role: 'ORGANISER' });
      const res = await eventsPost(
        buildRequest({
          method: 'POST',
          path: '/api/events',
          body: validEvent,
          cookies: await accessCookieFor(organiser),
        }),
        ctx,
      );
      expect(res.status).toBe(201);
      const body = await readJson(res);
      expect(body.data.event.organiserId).toBe(organiser.id);
      expect(body.data.event.status).toBe('DRAFT');
    });

    it('organiser is forbidden from admin venue creation -> 403', async () => {
      const organiser = await createUser({ role: 'ORGANISER' });
      const res = await venuesPost(
        buildRequest({
          method: 'POST',
          path: '/api/admin/venues',
          body: validVenue,
          cookies: await accessCookieFor(organiser),
        }),
        ctx,
      );
      expect(res.status).toBe(403);
    });

    it('organiser only sees their own events', async () => {
      const orgA = await createUser({ role: 'ORGANISER' });
      const orgB = await createUser({ role: 'ORGANISER' });
      await eventsPost(
        buildRequest({
          method: 'POST',
          path: '/api/events',
          body: { title: 'A event', type: 'MOVIE' },
          cookies: await accessCookieFor(orgA),
        }),
        ctx,
      );
      await eventsPost(
        buildRequest({
          method: 'POST',
          path: '/api/events',
          body: { title: 'B event', type: 'CONCERT' },
          cookies: await accessCookieFor(orgB),
        }),
        ctx,
      );
      const res = await organiserEventsGet(
        buildRequest({ path: '/api/organiser/events', cookies: await accessCookieFor(orgA) }),
        ctx,
      );
      const body = await readJson(res);
      expect(body.data.events).toHaveLength(1);
      expect(body.data.events[0].title).toBe('A event');
    });
  });

  describe('admin authorization', () => {
    it('admin POST + GET /api/admin/venues works', async () => {
      const admin = await createUser({ role: 'ADMIN' });
      const create = await venuesPost(
        buildRequest({
          method: 'POST',
          path: '/api/admin/venues',
          body: validVenue,
          cookies: await accessCookieFor(admin),
        }),
        ctx,
      );
      expect(create.status).toBe(201);

      const list = await venuesGet(
        buildRequest({ path: '/api/admin/venues', cookies: await accessCookieFor(admin) }),
        ctx,
      );
      expect(list.status).toBe(200);
      expect((await readJson(list)).data.venues).toHaveLength(1);
    });

    it('admin is forbidden from the organiser-only event creation endpoint -> 403', async () => {
      // Event creation requires the ORGANISER role specifically; an admin is not
      // an organiser and must not be silently allowed.
      const admin = await createUser({ role: 'ADMIN' });
      const res = await eventsPost(
        buildRequest({
          method: 'POST',
          path: '/api/events',
          body: validEvent,
          cookies: await accessCookieFor(admin),
        }),
        ctx,
      );
      expect(res.status).toBe(403);
    });
  });

  describe('public catalogue access', () => {
    it('GET /api/events is public (200) even without auth', async () => {
      const res = await eventsGet(buildRequest({ path: '/api/events' }), ctx);
      expect(res.status).toBe(200);
    });
  });
});
