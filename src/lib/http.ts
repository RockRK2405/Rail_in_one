import { NextRequest, NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, Errors, isAppError } from './errors';
import { logger } from './logger';

/**
 * HTTP layer: consistent response envelopes, centralised error handling, and a
 * route wrapper so business logic never has to build responses or catch its own
 * errors. Handlers throw `AppError` (or let Zod/Prisma throw) and return plain
 * data; this module serialises everything uniformly.
 *
 * Success envelope: { "data": <payload> }
 * Error envelope:   { "error": { "code", "message", "details"? } }
 */

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

export function created<T>(data: T): NextResponse {
  return ok(data, 201);
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

function errorEnvelope(err: AppError): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    },
    { status: err.status },
  );
}

/** Normalises any thrown value into an AppError. */
function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;

  if (err instanceof ZodError) {
    return Errors.validation('Request validation failed', err.flatten());
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Unique constraint violation -> conflict.
    if (err.code === 'P2002') {
      return Errors.conflict('A record with these values already exists');
    }
    // Record not found for an update/delete.
    if (err.code === 'P2025') {
      return Errors.notFound();
    }
  }

  return Errors.internal();
}

type RouteContext = { params: Record<string, string> };
type RouteHandler = (req: NextRequest, ctx: RouteContext) => Promise<NextResponse> | NextResponse;

/**
 * Wraps a route handler with request logging and centralised error handling.
 * Usage:
 *   export const POST = handler(async (req) => { ... return created(x); });
 */
export function handler(fn: RouteHandler): RouteHandler {
  return async (req: NextRequest, ctx: RouteContext) => {
    const requestId = crypto.randomUUID();
    const log = logger.child({ requestId, method: req.method, path: req.nextUrl.pathname });
    const start = Date.now();
    try {
      const res = await fn(req, ctx ?? { params: {} });
      log.info({ status: res.status, ms: Date.now() - start }, 'request completed');
      res.headers.set('x-request-id', requestId);
      return res;
    } catch (err) {
      const appErr = toAppError(err);
      if (appErr.status >= 500) {
        log.error({ err, code: appErr.code }, 'request failed (server error)');
      } else {
        log.warn({ code: appErr.code, ms: Date.now() - start }, 'request rejected');
      }
      const res = errorEnvelope(appErr);
      res.headers.set('x-request-id', requestId);
      return res;
    }
  };
}

/**
 * Parse and validate a JSON request body against a Zod schema.
 * Returns the schema's OUTPUT type (defaults/transforms applied). We infer from
 * `S extends ZodTypeAny` (not `ZodSchema<T>`) so schemas with `.default()` or
 * `.transform()` resolve to their output shape, not their looser input shape.
 */
export async function parseJson<S extends ZodTypeAny>(
  req: NextRequest,
  schema: S,
): Promise<S['_output']> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw Errors.validation('Request body must be valid JSON');
  }
  return schema.parse(raw);
}

/** Parse and validate query-string parameters against a Zod schema (output type). */
export function parseQuery<S extends ZodTypeAny>(req: NextRequest, schema: S): S['_output'] {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  return schema.parse(params);
}

/** Safely read a required dynamic route parameter (e.g. ctx.params.id). */
export function param(ctx: { params: Record<string, string> }, key: string): string {
  const value = ctx.params[key];
  if (!value) throw Errors.validation(`Missing route parameter: ${key}`);
  return value;
}
