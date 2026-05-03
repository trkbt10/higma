/**
 * @file API path definitions shared between api and web.
 *
 * Single source of truth for API endpoints, ensuring both the server
 * and client reference the same paths.
 */

/** All API path definitions. */
export type ApiPaths = {
  readonly users: "/api/users";
  readonly userById: "/api/users/:id";
  readonly health: "/api/health";
};

/** Concrete API path values. */
export const apiPaths = {
  users: "/api/users",
  userById: "/api/users/:id",
  health: "/api/health",
} as const satisfies ApiPaths;
