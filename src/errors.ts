/**
 * Typed errors shared by the engine pass functions (src/passes.ts) and the
 * route layer. Kept dependency-free so both `withAuth` (src/auth.ts) and the
 * session-authed graph routes can map them to HTTP status codes without
 * importing the heavy pass module.
 */

/** A bad caller input (invalid k, empty content, malformed payload). Maps to 400. */
export class PassValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PassValidationError";
  }
}

/** A precondition is unmet (e.g. tension-pass with no clusters yet). Maps to 400. */
export class PassPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PassPreconditionError";
  }
}
