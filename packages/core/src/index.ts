/**
 * @file Core package root entry point.
 *
 * Domain types and DTOs are accessed via subpath exports:
 *   import type { User } from "@monorepo/core/domain/user"
 *   import type { UserResponse } from "@monorepo/core/dto/user"
 *
 * Barrel imports (e.g., "@monorepo/core/domain") are prohibited.
 * Always import from the specific module file.
 */
