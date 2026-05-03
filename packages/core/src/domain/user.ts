/**
 * @file Domain model: User
 */

/** Branded type for user IDs to prevent accidental misuse of plain strings. */
export type UserId = string & { readonly __brand: "UserId" };

/** Core user domain model. */
export type User = {
  readonly id: UserId;
  readonly name: string;
  readonly email: string;
  readonly createdAt: Date;
};
