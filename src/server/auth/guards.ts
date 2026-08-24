import type { NextRequest } from 'next/server';
import type { UserRole } from '@prisma/client';
import { Errors } from '@/lib/errors';
import { getAuth, type AuthPrincipal } from './session';

/**
 * Server-side authorization guards. Every protected route handler calls
 * `requireAuth` (authentication) and, where a role is required, `requireRole`.
 * Authorization is ALWAYS enforced here on the server — never trusted from the
 * client. Object-level ownership checks live in services (e.g. booking.userId
 * === principal.id) and use `assertOwnership`.
 */

/** Require a valid session; throw 401 otherwise. */
export async function requireAuth(req: NextRequest): Promise<AuthPrincipal> {
  const principal = await getAuth(req);
  if (!principal) {
    throw Errors.unauthenticated();
  }
  return principal;
}

/** Require a valid session whose role is one of `roles`; throw 401/403 otherwise. */
export async function requireRole(req: NextRequest, ...roles: UserRole[]): Promise<AuthPrincipal> {
  const principal = await requireAuth(req);
  if (!roles.includes(principal.role)) {
    throw Errors.forbidden();
  }
  return principal;
}

/**
 * Object-level authorization: the principal must own the resource, unless they
 * hold one of the `bypassRoles` (e.g. ADMIN). Throws 403 otherwise.
 */
export function assertOwnership(
  principal: AuthPrincipal,
  ownerId: string,
  bypassRoles: UserRole[] = [],
): void {
  if (principal.id === ownerId) return;
  if (bypassRoles.includes(principal.role)) return;
  throw Errors.forbidden();
}
