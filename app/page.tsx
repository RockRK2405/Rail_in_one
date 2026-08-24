import Link from 'next/link';
import { CalendarDays, Radio, ShieldCheck, Ticket } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function upcomingCount(): Promise<number> {
  return prisma.show.count({ where: { status: 'SCHEDULED', startsAt: { gte: new Date() } } });
}

export default async function LandingPage() {
  const shows = await upcomingCount().catch(() => 0);

  return (
    <div className="space-y-16">
      <section className="mx-auto grid max-w-4xl gap-6 text-center">
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Live seat availability
        </p>
        <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
          Movies &amp; concerts, booked in seconds.
        </h1>
        <p className="mx-auto max-w-2xl text-balance text-lg text-muted-foreground">
          Pick your seats on a live map, hold them while you check out, and get an emailed QR
          ticket. Sold out? Join the waitlist — freed seats go to the next in line, in order.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <Link href="/events" className={buttonVariants({ size: 'lg' })}>
            Browse {shows > 0 ? `${shows} upcoming shows` : 'events'}
          </Link>
          <Link href="/register" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            Create an account
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Feature
          Icon={Radio}
          title="Live seat map"
          body="Available, held and booked seats update instantly for everyone in the room."
        />
        <Feature
          Icon={ShieldCheck}
          title="Safe holds"
          body="Two people can never hold the same seat — the database is the source of truth."
        />
        <Feature
          Icon={CalendarDays}
          title="Fair waitlist"
          body="First-in, first-out time-limited offers when someone cancels."
        />
      </section>

      <section className="mx-auto max-w-3xl rounded-lg border bg-card p-6 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <Ticket className="h-4 w-4" aria-hidden /> Try the demo
        </p>
        <p className="mt-2 text-muted-foreground">
          Sign in as a customer, organiser or admin to explore the flows. Demo credentials are in
          the project README.
        </p>
      </section>
    </div>
  );
}

function Feature({
  Icon,
  title,
  body,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <Icon className="h-5 w-5" aria-hidden />
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
