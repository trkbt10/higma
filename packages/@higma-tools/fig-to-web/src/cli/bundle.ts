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
  }) => Promise<{ readonly success: boolean; readonly logs: readonly BunBuildLog[] }>;
};

type BunBuildLog = {
  readonly message?: string;
  readonly level?: string;
  readonly position?: { readonly file?: string; readonly line?: number; readonly column?: number };
};

/**
 * Render a Bun.build log entry into a single line. Bun's log objects are
 * not always plain `{message}` — file/line position info is available
 * separately and a missing `.message` would otherwise yield "undefined"
 * in the joined output. Surfacing the position makes a "Bundle failed"
 * panel actually point the developer at the offending file.
 */
function formatBuildLog(log: BunBuildLog): string {
  const position = log.position;
  const where = position?.file
    ? ` ${position.file}${position.line !== undefined ? `:${position.line}${position.column !== undefined ? `:${position.column}` : ""}` : ""}`
    : "";
  const level = log.level ? `[${log.level}]` : "";
  const body = log.message ?? JSON.stringify(log);
  return `${level}${where} ${body}`.trim();
}

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
  // Bun.build can fail in two distinct ways:
  //   - It rejects with an Error (e.g. an unresolved module surfaces as a
  //     thrown `BuildMessage`). In that case `result` never binds.
  //   - It resolves with `{ success: false, logs }`. `logs` may carry
  //     structured entries whose `.message` is on a sub-property; joining
  //     `l.message` directly produced empty / "undefined" strings and
  //     swallowed the actual diagnostic.
  // Both paths must surface the underlying messages — silent "Bundle
  // failed" with no detail violated the no-fallback / fail-fast contract.
  const result = await runBunBuild({
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
    const messages = result.logs.length > 0
      ? result.logs.map(formatBuildLog).join("\n")
      : "Bun.build returned success: false but emitted no diagnostics.";
    throw new Error(`fig-to-web: preview bundle failed:\n${messages}`);
  }
}

type BunBuildOptions = Parameters<NonNullable<typeof Bun>["build"]>[0];
type BunBuildResult = Awaited<ReturnType<NonNullable<typeof Bun>["build"]>>;

/**
 * Wrapper that converts a thrown `Bun.build` failure into the same
 * `{ success, logs }` shape the resolved-failure path uses, so the
 * caller has a single message-extraction code path.
 */
async function runBunBuild(options: BunBuildOptions): Promise<BunBuildResult> {
  if (typeof Bun === "undefined" || typeof Bun.build !== "function") {
    throw new Error("fig-to-web: Bun runtime disappeared between feature checks");
  }
  return await Bun.build(options).catch((err: unknown) => {
    const logs = extractBuildLogsFromError(err);
    if (logs.length > 0) {
      return { success: false, logs } as BunBuildResult;
    }
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, logs: [{ level: "error", message }] } as BunBuildResult;
  });
}

/**
 * Bun's thrown build errors expose their per-message details on
 * `err.errors` (BuildMessage[]). Pull them out so `bundlePreview` can
 * forward each as a `BunBuildLog`. If the shape does not match (older
 * Bun, or a non-build runtime error), we fall through to the generic
 * single-message path in `runBunBuild`.
 */
function extractBuildLogsFromError(err: unknown): readonly BunBuildLog[] {
  if (typeof err !== "object" || err === null) {
    return [];
  }
  const errors = (err as { readonly errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors.map((entry: unknown): BunBuildLog => {
    if (typeof entry !== "object" || entry === null) {
      return { message: String(entry) };
    }
    return entry as BunBuildLog;
  });
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

