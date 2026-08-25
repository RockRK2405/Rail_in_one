import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware — applies security headers to every response.
 *
 * Notes:
 *  - No CSP is set here: the app currently uses inline styles and Tailwind, and
 *    a strict CSP would require nonces plumbed through Next's inline scripts.
 *    We stick to headers that are safe without further plumbing.
 *  - No CORS headers are set: this app serves its own frontend from the same
 *    origin. If a public API is ever introduced, add a per-route CORS layer.
 */
export function middleware(_req: NextRequest) {
  const res = NextResponse.next();
  const h = res.headers;

  // Framing / clickjacking
  h.set('X-Frame-Options', 'DENY');
  // MIME sniffing
  h.set('X-Content-Type-Options', 'nosniff');
  // Referrer leaks
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Reduce browser feature surface for third parties
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  // Force HTTPS in production (harmless on HTTP dev, since the browser only
  // honours HSTS on HTTPS responses anyway).
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  return res;
}

// Skip static assets and the SSE stream (which sets its own headers via a raw
// Response and must remain a long-lived text/event-stream).
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/shows/.*/stream).*)'],
};
