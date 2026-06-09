/**
 * Maps thrown engine errors to HTTP responses, shared by the Bearer route
 * wrapper (withAuth) and the session-authed graph routes so both return the
 * same status codes for the same failures.
 */

import { NextResponse } from "next/server";
import { PassValidationError, PassPreconditionError } from "./errors";

/**
 * A PassValidationError or PassPreconditionError becomes a 400 with its
 * message; any other error becomes a 500. Returns a NextResponse ready to send.
 */
export function mapPassError(error: unknown): NextResponse {
  if (
    error instanceof PassValidationError ||
    error instanceof PassPreconditionError
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  const message =
    error instanceof Error ? error.message : "Internal server error";
  return NextResponse.json({ error: message }, { status: 500 });
}
