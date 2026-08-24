import { prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';
import type { AuthPrincipal } from '@/server/auth/session';
import type { CreateCategoryInput, CreateSeatLayoutInput } from '@/server/validation/admin.schema';

/** Admin operations: venues, seat categories, seat layouts, and user overview. */
export const adminService = {
  async listVenues() {
    const venues = await prisma.venue.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { seats: true, seatCategories: true, shows: true } },
      },
    });
    return venues.map((v) => ({
      id: v.id,
      name: v.name,
      city: v.city,
      address: v.address,
      seats: v._count.seats,
      categories: v._count.seatCategories,
      shows: v._count.shows,
    }));
  },

  async getVenue(venueId: string) {
    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      include: {
        seatCategories: {
          orderBy: { rank: 'asc' },
          include: { _count: { select: { seats: true } } },
        },
      },
    });
    if (!venue) throw Errors.notFound('Venue not found');
    return {
      id: venue.id,
      name: venue.name,
      city: venue.city,
      address: venue.address,
      categories: venue.seatCategories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        rank: c.rank,
        seats: c._count.seats,
      })),
    };
  },

  async createCategory(venueId: string, input: CreateCategoryInput) {
    const venue = await prisma.venue.findUnique({ where: { id: venueId }, select: { id: true } });
    if (!venue) throw Errors.notFound('Venue not found');
    try {
      return await prisma.seatCategory.create({
        data: { venueId, name: input.name, color: input.color, rank: input.rank },
      });
    } catch {
      throw Errors.conflict('A category with that name already exists for this venue');
    }
  },

  /** Bulk-create a rectangular block of seats for a category. */
  async createSeatLayout(venueId: string, input: CreateSeatLayoutInput) {
    const category = await prisma.seatCategory.findFirst({
      where: { id: input.seatCategoryId, venueId },
      select: { id: true },
    });
    if (!category) throw Errors.invalidRequest('Category does not belong to this venue');

    // Compute a y-offset so new rows stack below any existing ones.
    const maxY = await prisma.seat.aggregate({ where: { venueId }, _max: { y: true } });
    const baseY = (maxY._max.y ?? 0) + 1;

    const data = input.rowLabels.flatMap((rowLabel, rowIdx) =>
      Array.from({ length: input.seatsPerRow }, (_, n) => ({
        venueId,
        seatCategoryId: input.seatCategoryId,
        section: input.section,
        rowLabel,
        seatNumber: n + 1,
        x: n + 1,
        y: baseY + rowIdx,
      })),
    );

    try {
      const result = await prisma.seat.createMany({ data, skipDuplicates: true });
      return { created: result.count };
    } catch {
      throw Errors.conflict('Some seats already exist for that section/row/number');
    }
  },

  async listUsers() {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
        _count: { select: { bookings: true } },
      },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
      bookings: u._count.bookings,
    }));
  },
};
