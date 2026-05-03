/**
 * @file Health check route.
 */
import { Hono } from "hono";

export const healthRoute = new Hono().get("/health", (c) => {
  return c.json({ status: "ok" });
});
