/**
 * @file API server entry point.
 */
import { serve } from "bun";
import { app } from "./app.ts";

const portEnv = process.env["PORT"];
if (!portEnv) {
  throw new Error("PORT environment variable is required");
}
const port = Number(portEnv);

serve({
  fetch: app.fetch,
  port,
});

console.log(`API server running on http://localhost:${String(port)}`);
