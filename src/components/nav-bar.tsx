'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Ticket, User as UserIcon } from 'lucide-react';
import { useAuth } from './auth-provider';
import { Button, buttonVariants } from './ui/button';

/** Top navigation. Role-aware links; shows sign-in when unauthenticated. */
export function NavBar() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.push('/');
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="container flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Ticket className="h-5 w-5" aria-hidden />
          <span>Ticketing</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/events" className="text-muted-foreground hover:text-foreground">
            Events
          </Link>

          {loading ? null : user ? (
            <>
              {user.role === 'CUSTOMER' && (
                <>
                  <Link
                    href="/account/bookings"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    My bookings
                  </Link>
                  <Link
                    href="/account/waitlist"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Waitlist
                  </Link>
                </>
              )}
              {user.role === 'ORGANISER' && (
                <Link href="/organiser" className="text-muted-foreground hover:text-foreground">
                  Organiser
                </Link>
              )}
              {user.role === 'ADMIN' && (
                <Link href="/admin" className="text-muted-foreground hover:text-foreground">
                  Admin
                </Link>
              )}
              <Link
                href="/account/profile"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                aria-label="Profile"
              >
                <UserIcon className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{user.fullName.split(' ')[0]}</span>
              </Link>
              <Button variant="ghost" size="sm" onClick={handleLogout} aria-label="Log out">
                <LogOut className="h-4 w-4" aria-hidden />
              </Button>
            </>
          ) : (
            <>
              <Link href="/login" className="text-muted-foreground hover:text-foreground">
                Log in
              </Link>
              <Link href="/register" className={buttonVariants({ size: 'sm' })}>
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
