/**
 * @file Visual verification harness — bundle the generated preview,
 * spin up a static server, drive a headless browser, and pixel-diff
 * the React render against the authoritative Figma SVG render for
 * every frame in an externally supplied `.fig` file.
 *
 * Verification only. Like `external-fig-verification.spec.ts` the path
 * is supplied at invocation time via `FIG_TO_WEB_VERIFY_FIG=<abs>` or
 * `FIG_TO_WEB_VERIFY_FIG_DIR=<abs-dir>`. The visual stage is
 * additionally gated on `FIG_TO_WEB_VERIFY_VISUAL=1` because it boots
 * a real bundler + browser, which is multiple orders of magnitude
 * slower than the structural harness.
 *
 * Workflow per `.fig`:
 *
 *   1. emitFromFrames(...) into a fresh temp directory.
 *   2. Write a chrome-less `isolate.html` + `isolate.tsx` next to the
 *      orchestrator-emitted files. These import any page component
 *      via `?frame=ComponentName` and mount it directly to `#root` —
 *      no App shell, no sidebar, no surrounding layout. Comparing
 *      `App.tsx`-shell screenshots to chrome-less Figma SVGs is
 *      apples-to-oranges; the isolate page is what makes the diff
 *      meaningful.
 *   3. Spawn `bun build` to bundle BOTH `main.tsx` and `isolate.tsx`.
 *      The `main.js` is what the human-facing preview UI loads;
 *      `isolate.js` is what the screenshot harness loads.
 *   4. Start a Node static server on a free ephemeral port.
 *   5. Launch a single headless Chromium via puppeteer, then for each
 *      frame target:
 *        - set the page viewport to the frame's authored width × height,
 *        - navigate to `figma/<slug>.html` and capture a full-page PNG,
 *        - navigate to `isolate.html?frame=<ComponentName>` and capture
 *          a full-page PNG,
 *        - pixelmatch the two PNGs at the same dimensions.
 *
 * Outputs (under `<out>/__visual-diff__/`):
 *
 *   - `<slug>.figma.png`, `<slug>.react.png` — the two captures,
 *   - `<slug>.diff.png` — pixelmatch diff overlay (only when there is
 *     a measurable difference),
 *   - `summary.json` — the diff percentages, machine-readable.
 *
 * The temp output dir is preserved on disk after the run so a human
 * can open it in a browser to inspect the source-of-truth side-by-side
 * preview. The path is logged at the start of each describe block.
 *
 * Threshold: `FIG_TO_WEB_VERIFY_VISUAL_THRESHOLD` (percent diff per
 * frame; default 15). Frames above the threshold count as failures.
 * The default is loose enough to absorb sub-pixel font-rendering
 * differences while still catching real layout, color, or asset
 * regressions.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import puppeteer from "puppeteer";
import type { Browser, Page } from "puppeteer";
import pixelmatch from "pixelmatch";

import { readPng, writePng, createPngImage } from "@higma-codecs/png";
import type { PngImage } from "@higma-codecs/png";

import {
  buildRegistry,
  emitFromFrames,
  listFrameTargets,
  loadFigSource,
} from "../src";
import type {
  EmitFile,
  EmitRegistry,
  FrameTarget,
} from "../src";
import type { FigSymbolContext } from "@higma-document-io/fig/context";
import { doctype, el, raw, text } from "../src/lib/html-tree/builder";
import { serialize } from "../src/lib/html-tree/serialize";
import type { HtmlNode } from "../src/lib/html-tree/types";

import type { FigNode } from "@higma-document-models/fig/types";
import { getNodeType, safeChildren } from "@higma-document-models/fig/domain";

// =============================================================================
// External .fig discovery (mirrors external-fig-verification.spec.ts so the
// two specs share an enable contract)
// =============================================================================

const ENV_SINGLE_FIG = "FIG_TO_WEB_VERIFY_FIG";
const ENV_DIR_OF_FIGS = "FIG_TO_WEB_VERIFY_FIG_DIR";
const ENV_VISUAL = "FIG_TO_WEB_VERIFY_VISUAL";
const ENV_VISUAL_THRESHOLD = "FIG_TO_WEB_VERIFY_VISUAL_THRESHOLD";

function listFigsInDir(dir: string): readonly string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  if (!fs.statSync(dir).isDirectory()) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.toLowerCase().endsWith(".fig"))
    .sort()
    .map((entry) => path.resolve(dir, entry));
}

function dedupePaths(paths: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (seen.has(p)) {
      continue;
    }
    seen.add(p);
    out.push(p);
  }
  return out;
}

function discoverFigPaths(): readonly string[] {
  const collected: string[] = [];
  const single = process.env[ENV_SINGLE_FIG];
  if (single && fs.existsSync(single)) {
    collected.push(path.resolve(single));
  }
  const dir = process.env[ENV_DIR_OF_FIGS];
  if (dir) {
    collected.push(...listFigsInDir(dir));
  }
  return dedupePaths(collected);
}

function diffThreshold(): number {
  const raw = process.env[ENV_VISUAL_THRESHOLD];
  if (!raw) {
    return 15;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(
      `${ENV_VISUAL_THRESHOLD} must be a number 0..100; got "${raw}"`,
    );
  }
  return parsed;
}

// =============================================================================
// Fig discovery (canvas + frames)
// =============================================================================

function listUserVisibleCanvases(source: FigSymbolContext): readonly FigNode[] {
  const out: FigNode[] = [];
  for (const root of source.tree.roots) {
    if (getNodeType(root) !== "DOCUMENT") {
      continue;
    }
    for (const child of safeChildren(root)) {
      if (getNodeType(child) === "CANVAS" && child.internalOnly !== true) {
        out.push(child);
      }
    }
  }
  return out;
}

function pickCanvasWithFrames(canvases: readonly FigNode[]): FigNode | undefined {
  for (const canvas of canvases) {
    if (listFrameTargets(canvas).length > 0) {
      return canvas;
    }
  }
  return undefined;
}

// =============================================================================
// Output dir + write step
// =============================================================================

async function writeOutputTree(
  outDir: string,
  files: readonly EmitFile[],
  assets: readonly { readonly path: string; readonly bytes: Uint8Array }[],
): Promise<void> {
  for (const file of files) {
    const fullPath = path.join(outDir, file.path);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, file.contents, "utf-8");
  }
  for (const asset of assets) {
    const fullPath = path.join(outDir, asset.path);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, asset.bytes);
  }
}

// =============================================================================
// Bun bundling (via subprocess) — vitest runs under Node, so the
// `Bun.build` / `Bun.serve` globals the production CLI relies on are
// unavailable inside the test process. Spawning `bun build` invokes
// the same toolchain the CLI ships with, so the bundle the test
// observes is byte-identical to what `bundlePreview()` would produce.
// =============================================================================

async function bunBuildEntries(outDir: string, entries: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "bun",
      [
        "build",
        ...entries,
        "--outdir",
        outDir,
        "--target",
        "browser",
        "--format",
        "esm",
        "--external",
        "react",
        "--external",
        "react/jsx-runtime",
        "--external",
        "react/jsx-dev-runtime",
        "--external",
        "react-dom/client",
        "--minify",
        "--sourcemap=external",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const stderrChunks: Buffer[] = [];
    const stdoutChunks: Buffer[] = [];
    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    proc.on("error", (err: Error) => {
      reject(new Error(`failed to spawn 'bun build': ${err.message}`));
    });
    proc.on("close", (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString();
      const stdout = Buffer.concat(stdoutChunks).toString();
      reject(new Error(`'bun build' exited with code ${code ?? "?"}.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

// =============================================================================
// Chrome-less isolation page
//
// The orchestrator emits `index.html` + `App.tsx` for human preview.
// That UI wraps every frame in a sidebar + side-by-side layout, which
// is the wrong target for a pixel-diff: we want the React component
// rendered alone, at exactly the authored frame size, with no chrome.
//
// `isolate.html` and `isolate.tsx` reuse the orchestrator-emitted
// `index.ts` re-exports (one entry per frame) so the harness can ask
// for any frame via `?frame=ComponentName`. The HTML head is borrowed
// verbatim from `index.html` to keep the importmap and Google Fonts
// links identical between the human preview and the screenshot
// surface — anything else would skew the pixel diff on every text
// layer.
// =============================================================================

const ISOLATE_TSX = [
  `import { createRoot } from "react-dom/client";`,
  `import * as Pages from "./index";`,
  ``,
  `const params = new URLSearchParams(location.search);`,
  `const name = params.get("frame") ?? "";`,
  `const components = Pages as Record<string, undefined | ((props?: unknown) => unknown)>;`,
  `const Component = components[name];`,
  `if (!Component) {`,
  `  document.title = "fig-to-web isolate: missing component '" + name + "'";`,
  `  throw new Error("isolate.tsx: no component named '" + name + "' in ./index re-exports");`,
  `}`,
  `const root = document.getElementById("root");`,
  `if (!root) {`,
  `  throw new Error("isolate.tsx: #root element missing in isolate.html");`,
  `}`,
  `createRoot(root).render(<Component />);`,
  `document.title = "fig-to-web isolate: " + name;`,
  ``,
].join("\n");

function buildIsolateHtml(headInner: string): string {
  // `headInner` is the inner HTML of `<head>` from the orchestrator-
  // generated `index.html`, which is itself produced by the html-tree
  // serializer — so it has already been escape-correct on every
  // attribute and text node. Embed it as `raw` to preserve the
  // already-validated markup; every other node here goes through the
  // builder.
  const document: HtmlNode[] = [
    doctype(),
    el("html", { lang: "en" }, [
      el("head", {}, [
        raw(headInner),
        el("style", {}, [
          text("html, body { margin: 0; padding: 0; background: #fff; } #root > * { width: max-content; }"),
        ]),
      ]),
      el("body", {}, [
        el("div", { id: "root" }),
        el("script", { type: "module", src: "./isolate.js" }),
      ]),
    ]),
  ];
  return `${serialize(document)}\n`;
}

async function emitIsolateFiles(outDir: string): Promise<void> {
  const indexHtml = await fsp.readFile(path.join(outDir, "index.html"), "utf-8");
  const match = indexHtml.match(/<head>([\s\S]*?)<\/head>/);
  if (!match || !match[1]) {
    throw new Error("emitted index.html has no <head> — cannot derive isolate.html");
  }
  const headInner = match[1]
    // Drop the production preview's <title> so the title-based readiness
    // probe in waitForIsolateReady cannot collide with it.
    .replace(/<title>[\s\S]*?<\/title>/, "");
  await fsp.writeFile(path.join(outDir, "isolate.html"), buildIsolateHtml(headInner), "utf-8");
  await fsp.writeFile(path.join(outDir, "isolate.tsx"), ISOLATE_TSX, "utf-8");
}

// =============================================================================
// Static HTTP server (Node) — replaces `startStaticServer` from src/cli
// for the same reason as the bundler: the spec process is Node-only.
// =============================================================================

const MIME_TYPES: ReadonlyMap<string, string> = new Map([
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

function mimeTypeFor(filePath: string): string {
  // Refuse to serve files whose extension we have not catalogued —
  // a silent `application/octet-stream` fallback would let the
  // browser silently mistype `tokens.css` or a misnamed `.tsx` if a
  // future emit ever wrote one. The harness only needs the small set
  // listed in `MIME_TYPES`; surfacing the missing extension makes the
  // gap visible instead of papering over it.
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES.get(ext);
  if (!mime) {
    throw new Error(`spec static server: no MIME type registered for extension "${ext}" (file=${filePath})`);
  }
  return mime;
}

type SpecServeHandle = {
  readonly url: string;
  readonly stop: () => Promise<void>;
};

async function startSpecStaticServer(rootDir: string): Promise<SpecServeHandle> {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    if (!req.url) {
      // Node sets `req.url` for every routed HTTP request; an
      // undefined here means the request never reached the request
      // line parser. Treat as a malformed client rather than
      // defaulting to `/` and serving index.html for every garbled
      // request.
      res.statusCode = 400;
      res.end("bad request");
      return;
    }
    // `String#split` always returns at least one element, so
    // `splitOnQuery[0]` is `string` (no fallback needed). Computing
    // it explicitly here documents the invariant.
    const splitOnQuery = req.url.split("?");
    const pathPart = splitOnQuery[0];
    if (pathPart === undefined) {
      throw new Error(`static server: split("?") returned no first element for url="${req.url}"`);
    }
    const decoded = decodeURIComponent(pathPart === "/" ? "/index.html" : pathPart);
    const candidate = path.join(root, decoded);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      res.statusCode = 403;
      res.end("forbidden");
      return;
    }
    fs.stat(candidate, (err, stat) => {
      if (err || !stat.isFile()) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      res.setHeader("Content-Type", mimeTypeFor(candidate));
      fs.createReadStream(candidate).pipe(res);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("static server: failed to bind a port");
  }
  const port = (address as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

// =============================================================================
// Pipeline driver
// =============================================================================

type VisualState = {
  readonly figPath: string;
  readonly outDir: string;
  readonly diffDir: string;
  readonly source: FigSymbolContext;
  readonly registry: EmitRegistry;
  readonly frames: readonly FigNode[];
  readonly browser: Browser;
  readonly page: Page;
  readonly server: SpecServeHandle;
  readonly serverUrl: string;
};

type Ref<T> = { value: T | null };

async function startVisualState(figPath: string): Promise<VisualState> {
  const buffer = await fsp.readFile(figPath);
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const source = await loadFigSource(bytes);
  const canvases = listUserVisibleCanvases(source);
  const canvas = pickCanvasWithFrames(canvases);
  if (!canvas) {
    throw new Error(`fig file "${figPath}" has no user-visible CANVAS with frame-like top-level children`);
  }
  const frames = listFrameTargets(canvas);
  const registry = buildRegistry(source, frames);
  const result = await emitFromFrames(source, frames, { debugAttrs: false });

  const slug = path.basename(figPath).replace(/[^A-Za-z0-9._-]/g, "_");
  const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), `fig-to-web-visual-${slug}-`));
  const diffDir = path.join(outDir, "__visual-diff__");
  await fsp.mkdir(diffDir, { recursive: true });
  await writeOutputTree(outDir, result.files, result.assets);

  // Drop the chrome-less isolation page next to the orchestrator-emitted
  // files so we can screenshot a single component without the App
  // shell.
  await emitIsolateFiles(outDir);

  // Bundle BOTH main.tsx (the preview UI) and isolate.tsx (the
  // screenshot surface) in a single Bun.build call. Subprocess-spawned
  // `bun build` is functionally equivalent to the `Bun.build` call
  // inside the production CLI (`bundlePreview`).
  await bunBuildEntries(outDir, [
    path.join(outDir, "main.tsx"),
    path.join(outDir, "isolate.tsx"),
  ]);

  const server = await startSpecStaticServer(outDir);
  const serverUrl = server.url;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (err: unknown) => {
    process.stderr.write(`  [browser pageerror] ${describeError(err)}\n`);
  });
  page.on("console", (msg) => {
    const t = msg.type();
    if (t === "error" || t === "warn") {
      process.stderr.write(`  [browser ${t}] ${msg.text()}\n`);
    }
  });

  return {
    figPath,
    outDir,
    diffDir,
    source,
    registry,
    frames,
    browser,
    page,
    server,
    serverUrl,
  };
}

async function stopVisualState(state: VisualState): Promise<void> {
  // Browser close errors during teardown have historically been
  // swallowed with a warning. Per the project's fail-fast policy we
  // surface the failure: a hung Chromium leaks zombie processes
  // across runs and silently masking the close failure makes that
  // hard to diagnose. The static server is stopped first regardless
  // of the browser outcome so we don't leak the server port either.
  const serverStop = state.server.stop();
  await state.browser.close();
  await serverStop;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

// =============================================================================
// Per-frame capture + compare
//
// The Figma side is a chrome-less HTML page already (figma/<slug>.html
// wraps just the SVG). The React side is rendered through the
// chrome-less isolate.html harness so neither capture has any UI
// surrounding the design.
// =============================================================================

function figmaSlugFor(target: FrameTarget): string {
  // Mirrors svgSlugFor in src/emit/figma-export/figma-svg.ts so the
  // harness asks the server for the same path the orchestrator wrote.
  return target.filePath
    .replace(/^pages\//, "")
    .replace(/\.tsx$/, "")
    .replace(/\//g, "__");
}

async function settleFonts(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  // One additional frame so the post-font-load layout pass is committed
  // before pixels are read out of the GPU.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

async function captureFigma(
  state: VisualState,
  target: FrameTarget,
  outPath: string,
): Promise<Buffer> {
  if (!target.node.size) {
    throw new Error(`frame "${target.node.name}" has no size — cannot capture authoritative SVG`);
  }
  const width = Math.round(target.node.size.x);
  const height = Math.round(target.node.size.y);
  await state.page.setViewport({ width, height, deviceScaleFactor: 1 });
  const figmaUrl = `${state.serverUrl}figma/${figmaSlugFor(target)}.html`;
  await state.page.goto(figmaUrl, { waitUntil: "networkidle0", timeout: 60_000 });
  await state.page.waitForSelector("svg", { timeout: 30_000 });
  await settleFonts(state.page);
  const buffer = await state.page.screenshot({
    type: "png",
    clip: { x: 0, y: 0, width, height },
    omitBackground: false,
    captureBeyondViewport: true,
    path: outPath as `${string}.png`,
  });
  return Buffer.from(buffer);
}

async function captureReact(
  state: VisualState,
  target: FrameTarget,
  outPath: string,
): Promise<Buffer> {
  if (!target.node.size) {
    throw new Error(`frame "${target.node.name}" has no size — cannot capture React render`);
  }
  const width = Math.round(target.node.size.x);
  const height = Math.round(target.node.size.y);
  await state.page.setViewport({ width, height, deviceScaleFactor: 1 });
  const isolateUrl = `${state.serverUrl}isolate.html?frame=${encodeURIComponent(target.componentName)}`;
  await state.page.goto(isolateUrl, { waitUntil: "networkidle0", timeout: 60_000 });
  await state.page.waitForFunction(
    () => {
      const root = document.getElementById("root");
      return root !== null && root.children.length > 0;
    },
    { timeout: 30_000 },
  );
  await settleFonts(state.page);
  const buffer = await state.page.screenshot({
    type: "png",
    clip: { x: 0, y: 0, width, height },
    omitBackground: false,
    captureBeyondViewport: true,
    path: outPath as `${string}.png`,
  });
  return Buffer.from(buffer);
}

type FrameDiffReport = {
  readonly frameName: string;
  readonly diffPercent: number;
  readonly diffPixels: number;
  readonly totalPixels: number;
  readonly figmaPath: string;
  readonly reactPath: string;
  readonly diffPath?: string;
};

async function compareFrame(
  state: VisualState,
  target: FrameTarget,
): Promise<FrameDiffReport> {
  const label = target.node.name ?? target.componentName;
  const slug = target.slug.length > 0 ? target.slug : target.componentName;
  const figmaPath = path.join(state.diffDir, `${slug}.figma.png`);
  const reactPath = path.join(state.diffDir, `${slug}.react.png`);
  const diffPath = path.join(state.diffDir, `${slug}.diff.png`);

  const figmaBuffer = await captureFigma(state, target, figmaPath);
  const reactBuffer = await captureReact(state, target, reactPath);

  return diffPngBuffers({
    frameName: label,
    figmaBuffer,
    reactBuffer,
    figmaPath,
    reactPath,
    diffPath,
  });
}

type DiffArgs = {
  readonly frameName: string;
  readonly figmaBuffer: Buffer;
  readonly reactBuffer: Buffer;
  readonly figmaPath: string;
  readonly reactPath: string;
  readonly diffPath: string;
};

function resizeTo(target: PngImage, source: PngImage): PngImage {
  if (source.width === target.width && source.height === target.height) {
    return source;
  }
  const out = createPngImage({ width: target.width, height: target.height });
  for (let y = 0; y < target.height; y += 1) {
    const sy = Math.floor((y / target.height) * source.height);
    for (let x = 0; x < target.width; x += 1) {
      const sx = Math.floor((x / target.width) * source.width);
      const srcIdx = (sy * source.width + sx) * 4;
      const dstIdx = (y * target.width + x) * 4;
      // `source.data` is a `Uint8Array` whose indices we just clamped
      // into bounds — index access returns `number`, never undefined.
      // Avoid `?? 0` defaults; they would mask any future signature
      // change that returned a different shape.
      out.data[dstIdx] = source.data[srcIdx];
      out.data[dstIdx + 1] = source.data[srcIdx + 1];
      out.data[dstIdx + 2] = source.data[srcIdx + 2];
      out.data[dstIdx + 3] = source.data[srcIdx + 3];
    }
  }
  return out;
}

function diffPngBuffers(args: DiffArgs): FrameDiffReport {
  const { frameName, figmaBuffer, reactBuffer, figmaPath, reactPath, diffPath } = args;
  const figmaImg = readPng(figmaBuffer);
  const reactImg = readPng(reactBuffer);
  const aligned = resizeTo(figmaImg, reactImg);
  const diff = createPngImage({ width: figmaImg.width, height: figmaImg.height });
  const diffPixels = pixelmatch(
    figmaImg.data,
    aligned.data,
    diff.data,
    figmaImg.width,
    figmaImg.height,
    { threshold: 0.1, includeAA: false },
  );
  const totalPixels = figmaImg.width * figmaImg.height;
  const diffPercent = totalPixels === 0 ? 0 : (diffPixels / totalPixels) * 100;
  const out: FrameDiffReport = {
    frameName,
    diffPercent,
    diffPixels,
    totalPixels,
    figmaPath,
    reactPath,
    diffPath: diffPixels > 0 ? diffPath : undefined,
  };
  if (diffPixels > 0) {
    fs.writeFileSync(diffPath, writePng(diff));
  }
  return out;
}

// =============================================================================
// Entry
// =============================================================================

const FIG_PATHS = discoverFigPaths();
const VISUAL_ENABLED = process.env[ENV_VISUAL] === "1";

if (FIG_PATHS.length === 0 || !VISUAL_ENABLED) {
  describe.skip(
    `fig-to-web visual verification — set ${ENV_SINGLE_FIG} (or ${ENV_DIR_OF_FIGS}) AND ${ENV_VISUAL}=1 to enable`,
    () => {
      it("skipped — visual harness not enabled", () => {
        // Intentionally empty: bundling a real React preview, booting
        // a static server, and driving headless Chromium is multiple
        // orders of magnitude slower than the structural harness, so
        // it is opt-in.
      });
    },
  );
} else {
  for (const figPath of FIG_PATHS) {
    describeVisualFigPath(figPath);
  }
}

function describeVisualFigPath(figPath: string): void {
  const figName = path.basename(figPath);
  describe(`fig-to-web visual verification — ${figName}`, () => {
    const stateRef: Ref<VisualState> = { value: null };
    const reportsRef: Ref<readonly FrameDiffReport[]> = { value: null };

    beforeAll(async () => {
      const state = await startVisualState(figPath);
      process.stdout.write(`  [visual] preview directory: ${state.outDir}\n`);
      process.stdout.write(`  [visual] preview URL: ${state.serverUrl}\n`);
      stateRef.value = state;
    }, 300_000);

    afterAll(async () => {
      const state = stateRef.value;
      if (!state) {
        return;
      }
      // Write `summary.json` only when the per-frame compare actually
      // ran. A null `reportsRef.value` means the diff test was skipped
      // (e.g., the bundle assertion failed earlier); writing an empty
      // summary would falsely advertise "0 frames diffed".
      const reports = reportsRef.value;
      if (reports !== null) {
        await fsp.writeFile(
          path.join(state.diffDir, "summary.json"),
          JSON.stringify(
            {
              figPath: state.figPath,
              outDir: state.outDir,
              threshold: diffThreshold(),
              frames: reports.map((r) => ({
                frame: r.frameName,
                diffPercent: r.diffPercent,
                diffPixels: r.diffPixels,
                totalPixels: r.totalPixels,
                figmaPng: path.relative(state.outDir, r.figmaPath),
                reactPng: path.relative(state.outDir, r.reactPath),
                diffPng: r.diffPath ? path.relative(state.outDir, r.diffPath) : undefined,
              })),
            },
            null,
            2,
          ),
        );
      }
      await stopVisualState(state);
    });

    it("bundles main.js and isolate.js (browser-loadable)", () => {
      const state = stateRef.value;
      if (!state) {
        throw new Error("visual state was not initialised");
      }
      for (const filename of ["main.js", "isolate.js"]) {
        const bundlePath = path.join(state.outDir, filename);
        expect(fs.existsSync(bundlePath), `expected ${bundlePath}`).toBe(true);
        const stat = fs.statSync(bundlePath);
        expect(stat.size, `${filename} bundle is empty`).toBeGreaterThan(0);
      }
    });

    it("isolate page mounts every registered frame component without runtime errors", async () => {
      const state = stateRef.value;
      if (!state) {
        throw new Error("visual state was not initialised");
      }
      const issues: string[] = [];
      for (const target of state.registry.frames.values()) {
        const url = `${state.serverUrl}isolate.html?frame=${encodeURIComponent(target.componentName)}`;
        await state.page.goto(url, { waitUntil: "networkidle0", timeout: 60_000 });
        await state.page
          .waitForFunction(
            () => {
              const root = document.getElementById("root");
              return root !== null && root.children.length > 0;
            },
            { timeout: 30_000 },
          )
          .catch((err: unknown) => {
            issues.push(`${target.componentName}: ${describeError(err)}`);
          });
        const title = await state.page.title();
        if (title.includes("missing component")) {
          issues.push(`${target.componentName}: isolate.tsx reported missing component`);
        }
      }
      expect(issues, issues.join("\n")).toEqual([]);
    }, 300_000);

    it("React render matches the Figma SVG within the configured threshold for every frame", async () => {
      const state = stateRef.value;
      if (!state) {
        throw new Error("visual state was not initialised");
      }
      const threshold = diffThreshold();
      const reports: FrameDiffReport[] = [];
      const issues: string[] = [];
      const targets = [...state.registry.frames.values()];
      for (const target of targets) {
        const report = await compareFrame(state, target);
        reports.push(report);
        process.stdout.write(
          `  [visual] frame "${report.frameName}": diff=${report.diffPercent.toFixed(2)}% (${report.diffPixels}/${report.totalPixels} px)\n`,
        );
        if (report.diffPercent > threshold) {
          issues.push(
            `frame "${report.frameName}" diff ${report.diffPercent.toFixed(2)}% exceeds threshold ${threshold}% — see ${report.diffPath ?? "(no diff png written)"}`,
          );
        }
      }
      reportsRef.value = reports;
      expect(issues, issues.join("\n")).toEqual([]);
    }, 600_000);
  });
}
