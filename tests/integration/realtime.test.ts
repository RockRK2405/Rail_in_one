import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Client } from 'pg';
import {
  seatChannel,
  publishSeatUpdates,
  type SeatUpdateMessage,
} from '@/server/realtime/seat-events';
import { seatHoldService } from '@/server/services/seat-hold.service';
import { testDb, truncateAll } from '../helpers/db';
import { createUser } from '../helpers/auth';
import { seedShow } from '../helpers/seed-show';

/** Wait for one NOTIFY on `channel`, or reject after `timeoutMs`. */
function waitForNotification(
  client: Client,
  channel: string,
  timeoutMs = 5000,
): Promise<SeatUpdateMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for NOTIFY')), timeoutMs);
    client.on('notification', (msg) => {
      if (msg.channel === channel && msg.payload) {
        clearTimeout(timer);
        resolve(JSON.parse(msg.payload) as SeatUpdateMessage);
      }
    });
  });
}

describe('realtime seat updates (LISTEN/NOTIFY)', () => {
  let listener: Client;

  beforeEach(async () => {
    await truncateAll();
    listener = new Client({ connectionString: process.env.DATABASE_URL });
    await listener.connect();
  });

  afterAll(async () => {
    await testDb.$disconnect();
  });

  it('delivers a published seat update to a LISTENer on the show channel', async () => {
    const showId = '11111111-1111-1111-1111-111111111111';
    const channel = seatChannel(showId);
    await listener.query(`LISTEN "${channel}"`);

    const received = waitForNotification(listener, channel);
    await publishSeatUpdates(showId, [
      { showSeatId: 'seat-1', status: 'HELD', holdExpiresAt: null },
    ]);

    const msg = await received;
    expect(msg.showId).toBe(showId);
    expect(msg.seats).toHaveLength(1);
    expect(msg.seats[0]!.status).toBe('HELD');

    await listener.end();
  });

  it('emits a HELD event when a hold is created', async () => {
    const show = await seedShow();
    const user = await createUser({ role: 'CUSTOMER' });
    const channel = seatChannel(show.showId);
    await listener.query(`LISTEN "${channel}"`);

    const received = waitForNotification(listener, channel);
    const hold = await seatHoldService.createHold({
      userId: user.id,
      showId: show.showId,
      showSeatIds: [show.showSeatIds[0]!],
    });

    const msg = await received;
    expect(msg.seats.map((s) => s.showSeatId)).toContain(show.showSeatIds[0]!);
    expect(msg.seats[0]!.status).toBe('HELD');
    expect(hold.holdId).toBeTruthy();

    await listener.end();
  });
});
