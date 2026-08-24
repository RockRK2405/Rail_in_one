import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10 text-center">
      <section className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Book movies &amp; concerts with real-time seats
        </h1>
        <p className="text-lg text-muted-foreground">
          Pick your seats on a live map, hold them while you check out, and get a QR ticket by
          email. Sold out? Join the waitlist and we&apos;ll offer freed seats in order.
        </p>
        <div className="flex justify-center gap-3">
          <Link href="/events" className={buttonVariants()}>
            Browse events
          </Link>
          <Link href="/register" className={buttonVariants({ variant: 'outline' })}>
            Create an account
          </Link>
        </div>
      </section>

      <section className="grid gap-4 text-left sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Live seat map</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription>
              Available, held, and booked seats update instantly for everyone.
            </CardDescription>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Safe holds</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription>
              Two people can never hold the same seat — the database is the source of truth.
            </CardDescription>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fair waitlist</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription>
              FIFO offers with time limits when seats free up from cancellations.
            </CardDescription>
          </CardContent>
        </Card>
      </section>

      <p className="text-sm text-muted-foreground">
        Phase 1 delivers accounts, roles, and the API/database foundation. Seat holds, booking,
        realtime, and waitlist arrive in later phases.
      </p>
    </div>
  );
}
