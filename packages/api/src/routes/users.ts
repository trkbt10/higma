/**
 * @file Users route.
 */
import { Hono } from "hono";
import { createUserRequestSchema } from "../schemas/user.ts";
import type { UserResponse } from "@monorepo/core/dto/user";
import type { UserId } from "@monorepo/core/domain/user";

export const usersRoute = new Hono()
  .get("/users", (c) => {
    const users: readonly UserResponse[] = [];
    return c.json(users);
  })
  .post("/users", async (c) => {
    const body = await c.req.json();
    const parsed = createUserRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const user: UserResponse = {
      id: crypto.randomUUID() as UserId,
      name: parsed.data.name,
      email: parsed.data.email,
      createdAt: new Date().toISOString(),
    };

    return c.json(user, 201);
  });
