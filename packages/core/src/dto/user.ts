/**
 * @file DTO: User request/response types shared between api and web.
 */
import type { UserId } from "../domain/user.ts";

/** Response DTO for a user resource. */
export type UserResponse = {
  readonly id: UserId;
  readonly name: string;
  readonly email: string;
  readonly createdAt: string;
};

/** Request DTO for creating a user. */
export type CreateUserRequest = {
  readonly name: string;
  readonly email: string;
};
