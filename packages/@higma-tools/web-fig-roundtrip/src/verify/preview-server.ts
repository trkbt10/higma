/**
 * @file Static-file HTTP server used by the verifier to host
 * fig-to-web's bundle output on a real port.
 *
 * fig-to-web's preview shell ships an `index.html` + `main.js`
 * bundle that React boots in the browser. To exercise that path the
 * verifier must serve the directory over HTTP and load it in
 * Chromium — the bundle's `import` statements assume a real
 * origin. We use Node's built-in `http` module rather than
 * `bun:http` so the verifier runs under either runtime.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, resolve } from "node:path";

const MIME: ReadonlyMap<string, string> = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".ttf", "font/ttf"],
]);

export type StaticPreview = {
  readonly url: string;
  readonly stop: () => Promise<void>;
};

/** Serve one generated preview directory over HTTP until the returned stop function is called. */
export async function startStaticPreview(rootDir: string): Promise<StaticPreview> {
  const root = resolve(rootDir);
  const server: Server = createServer((req, res) => {
    const requestUrl = req.url ?? "/";
    const pathname = requestUrl.split("?")[0] ?? "/";
    // Trailing-slash requests behave as directory lookups: serve the
    // `index.html` inside that directory the way a real static host
    // would.
    const target = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
    // Reject directory traversal — anything that escapes `root` must
    // 404 rather than expose host files.
    const resolved = resolve(join(root, target));
    if (!resolved.startsWith(root)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    stat(resolved).then((info) => {
      if (!info.isFile()) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const ext = extname(resolved).toLowerCase();
      const mime = MIME.get(ext) ?? "application/octet-stream";
      res.statusCode = 200;
      res.setHeader("content-type", mime);
      res.setHeader("cache-control", "no-store");
      createReadStream(resolved).pipe(res);
    }).catch(() => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("startStaticPreview: server did not bind a TCP port");
  }
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    stop: () => new Promise<void>((resolveStop) => {
      server.close(() => resolveStop());
    }),
  };
}
