import type { Event, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { EventListQuery } from '@/server/validation/event.schema';

/** Data-access for events. */
export const eventRepository = {
  async listPublished(query: EventListQuery): Promise<{ items: Event[]; total: number }> {
    const where: Prisma.EventWhereInput = {
      status: 'PUBLISHED',
      ...(query.type ? { type: query.type } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.city
        ? { shows: { some: { venue: { city: { equals: query.city, mode: 'insensitive' } } } } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.event.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.event.count({ where }),
    ]);
    return { items, total };
  },

  findPublishedById(id: string): Promise<Event | null> {
    return prisma.event.findFirst({ where: { id, status: 'PUBLISHED' } });
  },

  findById(id: string): Promise<Event | null> {
    return prisma.event.findUnique({ where: { id } });
  },

  listByOrganiser(organiserId: string): Promise<Event[]> {
    return prisma.event.findMany({ where: { organiserId }, orderBy: { createdAt: 'desc' } });
  },

  create(data: Prisma.EventCreateInput): Promise<Event> {
    return prisma.event.create({ data });
  },
};
