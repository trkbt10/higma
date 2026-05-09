/**
 * @file Bundle the generated preview into a single browser-loadable JS.
 *
 * After the emit pipeline writes `main.tsx` / `App.tsx` / each page TSX
 * into the output directory, this step compiles them into a single
 * `main.js` that the generated `index.html` loads via `<script
 * type="module" src="./main.js">`. React itself stays out of the
 * bundle — the importmap in `index.html` resolves `react`,
 * `react/jsx-runtime`, and `react-dom/client` against esm.sh, so the
 * output directory stays free of `node_modules` and any package.json
 * boilerplate. That matches the brief: the result must be browser-
 * runnable without bootstrapping a separate React project.
 *
 * Bun is the only supported bundler runtime — the package's
 * `packageManager` field already pins it. If the host runtime ever
 * lacks `Bun.build` we fail loudly rather than silently emitting an
 * un-runnable preview.
 */
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const REACT_EXTERNALS: readonly string[] = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom/client",
];

declare const Bun: undefined | {
  readonly build: (options: {
    readonly entrypoints: readonly string[];
    readonly outdir: string;
    readonly target: "browser";
    readonly format: "esm";
    readonly external: readonly string[];
    readonly minify?: boolean;
    readonly sourcemap?: "external" | "inline" | "none";
    readonly root?: string;
    readonly naming?: { readonly entry?: string };
    readonly define?: Record<string, string>;
  }) => Promise<{ readonly success: boolean; readonly logs: readonly { readonly message: string }[] }>;
};

/**
 * Bundle every entry tsx written by the emit pipeline into matching
 * `.js` siblings: the dual-pane preview's `main.tsx` → `main.js` AND
 * each standalone frame's `pages/<canvas>/<slug>/standalone.tsx` →
 * `pages/<canvas>/<slug>/standalone.js`. The standalone entries
 * power the verifier's per-frame Chromium screenshots; without them
 * the standalone HTMLs would 404 when they fetch their script.
 *
 * Throws on build failures — the CLI surfaces the message to stderr.
 */
export async function bundlePreview(outDir: string): Promise<void> {
  if (typeof Bun === "undefined" || typeof Bun.build !== "function") {
    throw new Error("fig-to-web --serve / preview bundling requires Bun (Bun.build). Run via `bun run`.");
  }
  const root = resolve(outDir);
  const entrypoints = [resolve(root, "main.tsx"), ...await collectStandaloneEntries(root)];
  const result = await Bun.build({
    entrypoints,
    outdir: root,
    root,
    target: "browser",
    format: "esm",
    external: [...REACT_EXTERNALS],
    sourcemap: "external",
    minify: true,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });
  if (!result.success) {
    const messages = result.logs.map((l) => l.message).join("\n");
    throw new Error(`fig-to-web: preview bundle failed:\n${messages}`);
  }
}

async function collectStandaloneEntries(root: string): Promise<readonly string[]> {
  const pagesDir = resolve(root, "pages");
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile() && entry.name === "standalone.tsx") {
        out.push(child);
      }
    }
  }
  await walk(pagesDir);
  return out;
}

