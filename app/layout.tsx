import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ticket Booking System',
  description: 'Book tickets for movies and concerts with real-time seat availability.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b">
          <div className="container flex h-14 items-center justify-between">
            <Link href="/" className="font-semibold">
              🎟️ Ticketing
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/events" className="text-muted-foreground hover:text-foreground">
                Events
              </Link>
              <Link href="/login" className="text-muted-foreground hover:text-foreground">
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground"
              >
                Sign up
              </Link>
            </nav>
          </div>
        </header>
        <main className="container py-10">{children}</main>
      </body>
    </html>
  );
}
