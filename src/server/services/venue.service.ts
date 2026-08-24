import type { Venue } from '@prisma/client';
import type { AuthPrincipal } from '@/server/auth/session';
import { venueRepository } from '@/server/repositories/venue.repository';
import type { CreateVenueInput } from '@/server/validation/venue.schema';

/** Venue business logic (admin-managed). */
export const venueService = {
  list(): Promise<Venue[]> {
    return venueRepository.list();
  },

  create(principal: AuthPrincipal, input: CreateVenueInput): Promise<Venue> {
    return venueRepository.create({
      name: input.name,
      city: input.city,
      address: input.address,
      timezone: input.timezone,
      creator: { connect: { id: principal.id } },
    });
  },
};
