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
import { resolve } from "node:path";

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
    readonly define?: Record<string, string>;
  }) => Promise<{ readonly success: boolean; readonly logs: readonly { readonly message: string }[] }>;
};

/**
 * Bundle `<outDir>/main.tsx` into `<outDir>/main.js`. Throws on build
 * failures — the CLI surfaces the message to stderr.
 */
export async function bundlePreview(outDir: string): Promise<void> {
  if (typeof Bun === "undefined" || typeof Bun.build !== "function") {
    throw new Error("fig-to-web --serve / preview bundling requires Bun (Bun.build). Run via `bun run`.");
  }
  const result = await Bun.build({
    entrypoints: [resolve(outDir, "main.tsx")],
    outdir: outDir,
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
