import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import { NavBar } from '@/components/nav-bar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ticketing — book movies and concerts',
  description:
    'Browse events, pick your seats on a live seat map, and get an emailed QR ticket. Real-time seat status and a fair waitlist for sold-out shows.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background antialiased">
        <Providers>
          <NavBar />
          <main className="container py-8 sm:py-10">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
