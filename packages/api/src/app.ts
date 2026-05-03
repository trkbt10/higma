/**
 * @file Hono application setup with route registration.
 */
import { Hono } from "hono";
import { healthRoute } from "./routes/health.ts";
import { usersRoute } from "./routes/users.ts";

export const app = new Hono()
  .route("/api", healthRoute)
  .route("/api", usersRoute);

export type AppType = typeof app;
