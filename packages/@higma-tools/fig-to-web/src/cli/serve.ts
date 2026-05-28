/**
 * @file Static-file HTTP server for previewing generated output.
 *
 * Plain `Bun.serve()` over the output directory, mapping `/` →
 * `index.html` and serving every other request as a static file with
 * the right Content-Type. This is the answer to "I want to see it in
 * a browser without bootstrapping a project": after the CLI bundles
 * `main.tsx` → `main.js`, the directory is fully self-sufficient and
 * a 50-line static server is all that's needed.
 *
 * No directory traversal: requested paths are resolved against the
 * output dir and rejected if they escape it.
 */
import { resolve, join, extname, sep } from "node:path";
import { stat } from "node:fs/promises";

declare const Bun: undefined | {
  readonly file: (path: string) => { readonly stream: () => ReadableStream };
  readonly serve: (options: {
    readonly port: number;
    readonly fetch: (req: Request) => Promise<Response> | Response;
  }) => { readonly port: number; readonly stop: () => void };
};

const MIME: ReadonlyMap<string, string> = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".tsx", "text/plain; charset=utf-8"],
  [".ts", "text/plain; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

function contentTypeFor(path: string): string {
  return MIME.get(extname(path).toLowerCase()) ?? "application/octet-stream";
}

function isInside(root: string, candidate: string): boolean {
  const r = resolve(root);
  const c = resolve(candidate);
  return c === r || c.startsWith(`${r}${sep}`);
}

async function fileExists(path: string): Promise<boolean> {
  return stat(path).then((s) => s.isFile()).catch(() => false);
}

export type ServeHandle = {
  readonly port: number;
  readonly stop: () => void;
};

/**
 * Start a tiny static HTTP server rooted at `outDir`. Returns a
 * handle whose `stop()` shuts the server down — the CLI keeps the
 * server alive until interrupted.
 */
export async function startStaticServer(outDir: string, port: number): Promise<ServeHandle> {
  if (typeof Bun === "undefined" || typeof Bun.serve !== "function") {
    throw new Error("fig-to-web --serve requires Bun (Bun.serve). Run via `bun run`.");
  }
  const root = resolve(outDir);
  const server = Bun.serve({
    port,
    fetch: async (req: Request) => {
      const url = new URL(req.url);
      const requested = url.pathname === "/" ? "/index.html" : url.pathname;
      const decoded = decodeURIComponent(requested);
      const candidate = join(root, decoded);
      if (!isInside(root, candidate)) {
        return new Response("forbidden", { status: 403 });
      }
      if (!(await fileExists(candidate))) {
        return new Response("not found", { status: 404 });
      }
      const file = (Bun as { readonly file: (path: string) => { readonly stream: () => ReadableStream } }).file(candidate);
      return new Response(file.stream(), {
        headers: { "Content-Type": contentTypeFor(candidate) },
      });
    },
  });
  return { port: server.port, stop: () => server.stop() };
}
