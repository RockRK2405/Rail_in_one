import type { Prisma, Venue } from '@prisma/client';
import { prisma } from '@/lib/db';

/** Data-access for venues. */
export const venueRepository = {
  list(): Promise<Venue[]> {
    return prisma.venue.findMany({ orderBy: { createdAt: 'desc' } });
  },

  create(data: Prisma.VenueCreateInput): Promise<Venue> {
    return prisma.venue.create({ data });
  },
};
