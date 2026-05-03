/**
 * @file Zod validation schemas for user-related operations.
 *
 * Validation is a consumer-side concern, not a core type concern.
 */
import { z } from "zod";
import type { UserId } from "@monorepo/core/domain/user";

/** Zod schema for UserId validation. */
export const userIdSchema = z.string().min(1).transform((v) => v as UserId);

/** Zod schema for CreateUserRequest validation. */
export const createUserRequestSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});
