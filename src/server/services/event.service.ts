import type { Event } from '@prisma/client';
import { Errors } from '@/lib/errors';
import type { AuthPrincipal } from '@/server/auth/session';
import { eventRepository } from '@/server/repositories/event.repository';
import type { CreateEventInput, EventListQuery } from '@/server/validation/event.schema';

/**
 * Event business logic. Read access to the catalogue is public but limited to
 * PUBLISHED events; creation is restricted to organisers (enforced at the route
 * via requireRole, and re-checked here by attributing ownership to the caller).
 */
export const eventService = {
  async listPublic(query: EventListQuery) {
    const { items, total } = await eventRepository.listPublished(query);
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  },

  async getPublicEvent(id: string): Promise<Event> {
    const event = await eventRepository.findPublishedById(id);
    if (!event) throw Errors.notFound('Event not found');
    return event;
  },

  async createForOrganiser(principal: AuthPrincipal, input: CreateEventInput): Promise<Event> {
    return eventRepository.create({
      title: input.title,
      description: input.description,
      type: input.type,
      genre: input.genre,
      posterUrl: input.posterUrl,
      status: 'DRAFT',
      organiser: { connect: { id: principal.id } },
    });
  },

  listForOrganiser(principal: AuthPrincipal): Promise<Event[]> {
    return eventRepository.listByOrganiser(principal.id);
  },
};
