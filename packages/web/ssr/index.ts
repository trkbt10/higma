/**
 * @file SSR entry point using Hono.
 *
 * Serves the Vite-built SPA shell. Runtime-agnostic (no Bun-specific APIs).
 * Static assets are served by reading the filesystem directly.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "../dist");

const app = new Hono();

/** Serve static assets from the Vite build output. */
app.get("/assets/*", (c) => {
  const filePath = join(distDir, c.req.path);
  if (!existsSync(filePath)) {
    return c.notFound();
  }
  const content = readFileSync(filePath);
  return new Response(content);
});

/** Catch-all: serve the SPA shell for client-side routing. */
app.get("*", (c) => {
  const html = readFileSync(resolve(distDir, "index.html"), "utf-8");
  return c.html(html);
});

export default app;
