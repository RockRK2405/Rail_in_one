import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET as eventsGet } from '../../app/api/events/route';
import { GET as eventGet } from '../../app/api/events/[id]/route';
import { buildRequest, readJson } from '../helpers/request';
import { testDb, truncateAll } from '../helpers/db';
import { createUser } from '../helpers/auth';

async function seedCatalogue() {
  const organiser = await createUser({ role: 'ORGANISER' });
  const published = await testDb.event.create({
    data: {
      organiserId: organiser.id,
      title: 'Published Movie',
      type: 'MOVIE',
      genre: 'Drama',
      status: 'PUBLISHED',
    },
  });
  const concert = await testDb.event.create({
    data: {
      organiserId: organiser.id,
      title: 'Published Concert',
      type: 'CONCERT',
      status: 'PUBLISHED',
    },
  });
  const draft = await testDb.event.create({
    data: { organiserId: organiser.id, title: 'Secret Draft', type: 'MOVIE', status: 'DRAFT' },
  });
  return { published, concert, draft };
}

describe('event catalogue access', () => {
  beforeEach(truncateAll);
  afterAll(() => testDb.$disconnect());

  it('lists only PUBLISHED events, never DRAFT', async () => {
    await seedCatalogue();
    const res = await eventsGet(buildRequest({ path: '/api/events' }), { params: {} });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const titles = body.data.items.map((e: { title: string }) => e.title);
    expect(titles).toContain('Published Movie');
    expect(titles).toContain('Published Concert');
    expect(titles).not.toContain('Secret Draft');
    expect(body.data.total).toBe(2);
  });

  it('filters by type', async () => {
    await seedCatalogue();
    const res = await eventsGet(buildRequest({ path: '/api/events?type=CONCERT' }), { params: {} });
    const body = await readJson(res);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].type).toBe('CONCERT');
  });

  it('searches by title with q', async () => {
    await seedCatalogue();
    const res = await eventsGet(buildRequest({ path: '/api/events?q=concert' }), { params: {} });
    const body = await readJson(res);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].title).toBe('Published Concert');
  });

  it('GET /api/events/:id returns a published event', async () => {
    const { published } = await seedCatalogue();
    const res = await eventGet(buildRequest({ path: `/api/events/${published.id}` }), {
      params: { id: published.id },
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).data.event.id).toBe(published.id);
  });

  it('GET /api/events/:id returns 404 for a DRAFT event (not publicly accessible)', async () => {
    const { draft } = await seedCatalogue();
    const res = await eventGet(buildRequest({ path: `/api/events/${draft.id}` }), {
      params: { id: draft.id },
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/events/:id returns 404 for a non-existent id', async () => {
    const res = await eventGet(
      buildRequest({ path: '/api/events/00000000-0000-0000-0000-000000000000' }),
      { params: { id: '00000000-0000-0000-0000-000000000000' } },
    );
    expect(res.status).toBe(404);
  });
});
