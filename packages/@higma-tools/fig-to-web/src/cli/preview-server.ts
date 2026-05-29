/**
 * @file Lazy preview server for `fig-to-web --serve`.
 *
 * The build-to-disk path (`--serve` absent) renders every frame's
 * authoritative SVG and bundles every standalone page up front — the
 * two dominant, per-frame costs. For a `.fig` with many frames that
 * makes `bin` startup slow even when the user only wants to look at one
 * page. This server moves all of that work to *page open*:
 *
 *   - startup does only the cheap, render-free setup — load is already
 *     done by the caller, here we just build the shared `EmitSession`
 *     (registry + token index + font plan) and start `Bun.serve`;
 *   - a frame's React TSX (page + the components it references), its
 *     image/icon assets, its standalone HTML, and its bundled
 *     `standalone.js` are produced the first time that page's iframe is
 *     requested;
 *   - a frame's authoritative SVG is rendered the first time its pane
 *     is requested.
 *
 * Each lazy artifact is memoised by the frame's page path so repeat
 * requests (and the inevitable favicon / reload traffic) reuse the
 * first generation.
 *
 * The preview shell itself is plain HTML + a small inline script — no
 * React, no bundle — so there is nothing to compile before the first
 * byte is served. Two panes per frame:
 *
 *   - **Figma source**: the exported SVG dropped *inline* into the
 *     shell document. It is just markup the renderer produced; the
 *     shell already links the same web fonts so its `<text>` layers
 *     resolve, and inlining avoids an iframe and an HTML wrapper file.
 *   - **React output**: an `<iframe>` pointing at the frame's
 *     standalone page — the real generated web page, mounted in its own
 *     document. The iframe is purely a viewing device: it reproduces a
 *     browser-isolated environment so the comparison against the SVG is
 *     faithful. The generated artifact itself contains no iframe.
 *
 * Generated files are written under `options.out` as they are produced,
 * so the directory fills in on demand and can be inspected afterwards.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import type { FigDocumentContext } from "@higma-document-io/fig/context";
import type { FigNode } from "@higma-document-models/fig/types";

import type { CliOptions } from "./args";
import { bundleEntrypoints } from "./bundle";
import {
  collectReferencedComponentTargets,
  createEmitSession,
  emitStandaloneFiles,
} from "../emit";
import type { EmitFile, EmitFromFramesOptions, FrameTarget } from "../emit";
import { emitComponentFile, emitPageFile } from "../emit/render/files";
import { renderFrameSvg, svgSlugFor } from "../emit/figma-export/figma-svg";
import { doctype, el, raw, text } from "../lib/html-tree/builder";
import { serialize } from "../lib/html-tree/serialize";
import type { HtmlNode } from "../lib/html-tree/types";

declare const Bun:
  | undefined
  | {
      readonly serve: (options: {
        readonly port: number;
        readonly fetch: (req: Request) => Promise<Response> | Response;
      }) => { readonly port: number; readonly stop: () => void };
    };

/** Minimal stdout/stderr sink — structurally compatible with `CliConsole`. */
export type PreviewConsole = {
  readonly info: (message: string) => void;
  readonly error: (message: string) => void;
};

export type ServeHandle = {
  readonly port: number;
  readonly stop: () => void;
};

export type StartPreviewServerArgs = {
  readonly source: FigDocumentContext;
  readonly frames: readonly FigNode[];
  readonly options: CliOptions;
  readonly output: PreviewConsole;
};

const MIME: ReadonlyMap<string, string> = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

function contentTypeFor(path: string): string {
  return MIME.get(extname(path).toLowerCase()) ?? "application/octet-stream";
}

function isInside(root: string, candidate: string): boolean {
  const r = resolve(root);
  const c = resolve(candidate);
  return c === r || c.startsWith(`${r}/`);
}

/**
 * Translate the parsed CLI flags into the emit-options shape. The CLI
 * already carries every field with the concrete (defaulted) value, so
 * this is a direct projection — the orchestrator re-validates on its
 * side.
 */
function emitOptionsFrom(options: CliOptions): EmitFromFramesOptions {
  return {
    debugAttrs: options.debugAttrs,
    exportStyle: options.exportStyle,
    cssMode: options.cssMode,
    cssImport: options.cssImport,
    variantStrategy: options.variantStrategy,
    assetStrategy: options.assetStrategy,
    assetComplexityThreshold: options.assetComplexityThreshold,
  };
}

/**
 * Per-frame data embedded in the shell. Field names (`svg`, `page`)
 * match the client script's property access verbatim — the descriptor
 * is serialised straight into the page as the script's `FRAMES`.
 */
type FrameDescriptor = {
  readonly id: string;
  readonly label: string;
  readonly svg: string;
  readonly page: string;
  readonly width: number | undefined;
  readonly height: number | undefined;
};

function describeFrame(target: FrameTarget): FrameDescriptor {
  const size = target.node.size;
  return {
    id: target.componentName,
    label: target.node.name ?? target.componentName,
    svg: `/figma/${svgSlugFor(target)}.svg`,
    page: `/pages/${target.canvasSlug}/${target.slug}/`,
    width: size ? Math.round(size.x) : undefined,
    height: size ? Math.round(size.y) : undefined,
  };
}

const SHELL_CSS = [
  "html, body { margin: 0; padding: 0; height: 100%; }",
  "body { font-family: system-ui, sans-serif; background: #1a1a1a; color: #f4f4f4; }",
  ".fig-preview-shell { display: flex; height: 100vh; }",
  ".fig-preview-shell aside { flex: 0 0 220px; overflow-y: auto; background: #111; border-right: 1px solid #2a2a2a; padding: 16px 0; }",
  ".fig-preview-shell aside h1 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin: 0 0 8px 16px; }",
  ".fig-preview-shell aside ul { list-style: none; margin: 0; padding: 0; }",
  ".fig-preview-nav button { display: block; width: 100%; text-align: left; background: none; border: 0; color: inherit; padding: 8px 16px; cursor: pointer; font: inherit; }",
  ".fig-preview-nav button:hover { background: #1f1f1f; }",
  ".fig-preview-nav button[aria-current=\"true\"] { background: #2962ff; color: #fff; }",
  ".fig-preview-main { flex: 1; overflow: auto; padding: 32px; }",
  ".fig-preview-main--side { display: flex; flex-direction: row; gap: 32px; align-items: flex-start; }",
  ".fig-preview-main--overlay { display: grid; place-items: start center; }",
  ".fig-preview-main--overlay .fig-preview-pane { grid-area: 1 / 1; }",
  ".fig-preview-main--overlay .fig-preview-pane:last-child .fig-preview-stage { mix-blend-mode: difference; }",
  ".fig-preview-pane header { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 8px; }",
  ".fig-preview-stage { background: #fff; color: #000; box-shadow: 0 2px 24px rgba(0, 0, 0, 0.4); position: relative; overflow: hidden; }",
  ".fig-preview-stage img, .fig-preview-stage iframe { display: block; border: 0; width: 100%; height: 100%; background: #fff; }",
  ".fig-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 10px; background: #fff; color: #555; font: 13px system-ui, sans-serif; z-index: 1; }",
  ".fig-loading[hidden] { display: none; }",
  ".fig-loading::before { content: \"\"; width: 14px; height: 14px; border: 2px solid #ccc; border-top-color: #2962ff; border-radius: 50%; animation: fig-spin 0.7s linear infinite; }",
  "@keyframes fig-spin { to { transform: rotate(360deg); } }",
].join("\n");

/**
 * Client-side shell logic. Plain ES5-flavoured JS embedded verbatim:
 * the frame list is injected as JSON at the `__FIG_FRAMES__` marker
 * (escaped so a frame name can never terminate the `<script>`).
 *
 * The Figma pane is an `<img>` whose `src` is the exported SVG at
 * `/figma/<slug>.svg` — the renderer outlines text to vector `<path>`s,
 * so the file is fully self-contained (no fonts, no scripts) and an
 * image is the honest element for it. The React pane is an `<iframe>`
 * at `/pages/<canvas>/<slug>/` — the generated page, mounted in its own
 * document so it runs like a real browser load. No markup is ever
 * injected into the shell document (no `innerHTML`); both panes are
 * server paths.
 *
 * Switching frames re-points both elements in the same turn and shows a
 * "generating" overlay over each pane until its `load` (or `error`)
 * fires. The overlay both signals that lazy generation is in flight and
 * covers the previously-shown frame, so the two panes are never a
 * mismatched pair.
 */
const SHELL_SCRIPT = String.raw`(function () {
  "use strict";
  var FRAMES = __FIG_FRAMES__;
  var figmaStage = document.getElementById("fig-figma-stage");
  var reactStage = document.getElementById("fig-react-stage");
  var figmaFrame = document.getElementById("fig-figma-frame");
  var reactFrame = document.getElementById("fig-react-frame");
  var figmaLoading = document.getElementById("fig-figma-loading");
  var reactLoading = document.getElementById("fig-react-loading");
  var main = document.getElementById("fig-main");
  var pageButtons = Array.prototype.slice.call(document.querySelectorAll("[data-fig-page]"));
  var modeButtons = Array.prototype.slice.call(document.querySelectorAll("[data-fig-mode]"));

  function frameById(id) {
    for (var i = 0; i < FRAMES.length; i += 1) {
      if (FRAMES[i].id === id) { return FRAMES[i]; }
    }
    return null;
  }

  function applyStageSize(frame) {
    var hasSize = typeof frame.width === "number" && typeof frame.height === "number";
    var w = hasSize ? frame.width + "px" : "";
    var h = hasSize ? frame.height + "px" : "";
    figmaStage.style.width = w; figmaStage.style.height = h;
    reactStage.style.width = w; reactStage.style.height = h;
  }

  figmaFrame.addEventListener("load", function () { figmaLoading.hidden = true; });
  figmaFrame.addEventListener("error", function () { figmaLoading.hidden = true; });
  reactFrame.addEventListener("load", function () { reactLoading.hidden = true; });

  function select(id) {
    var frame = frameById(id);
    if (!frame) { return; }
    for (var i = 0; i < pageButtons.length; i += 1) {
      pageButtons[i].setAttribute("aria-current", pageButtons[i].getAttribute("data-fig-page") === id ? "true" : "false");
    }
    applyStageSize(frame);
    // Cover both panes before navigating so the prior frame is never
    // left on screen against the new one while generation is in flight.
    figmaLoading.hidden = false;
    reactLoading.hidden = false;
    figmaFrame.src = frame.svg;
    reactFrame.src = frame.page;
  }

  function setMode(mode) {
    main.className = "fig-preview-main fig-preview-main--" + mode;
    for (var i = 0; i < modeButtons.length; i += 1) {
      modeButtons[i].setAttribute("aria-current", modeButtons[i].getAttribute("data-fig-mode") === mode ? "true" : "false");
    }
  }

  pageButtons.forEach(function (btn) {
    btn.addEventListener("click", function () { select(btn.getAttribute("data-fig-page")); });
  });
  modeButtons.forEach(function (btn) {
    btn.addEventListener("click", function () { setMode(btn.getAttribute("data-fig-mode")); });
  });

  setMode("side");
  if (FRAMES.length > 0) { select(FRAMES[0].id); }
})();`;

/**
 * Embed the frame list into the shell script. Escaping `<` is enough to
 * stop a frame name from closing the `<script>` element or opening an
 * HTML comment while staying valid JSON.
 */
function buildShellScript(frames: readonly FrameDescriptor[]): string {
  const json = JSON.stringify(frames).replace(/</g, "\\u003c");
  return SHELL_SCRIPT.replace("__FIG_FRAMES__", json);
}

function loadingOverlay(id: string): HtmlNode {
  return el("div", { class: "fig-loading", id, hidden: "" }, [text("生成中…")]);
}

function buildShellHtml(frames: readonly FrameDescriptor[]): string {
  const navItems: HtmlNode[] = frames.map((frame) =>
    el("li", {}, [
      el("button", { type: "button", "data-fig-page": frame.id, "aria-current": "false" }, [text(frame.label)]),
    ]),
  );
  const head: HtmlNode[] = [
    el("meta", { charset: "utf-8" }),
    el("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
    el("title", {}, [text("fig-to-web preview")]),
    // No font links here: each pane is its own document (the served SVG
    // carries an @import when web fonts are needed; the standalone page
    // links them itself). The shell only renders system-ui chrome.
    el("style", {}, [raw(SHELL_CSS)]),
  ];
  const body: HtmlNode[] = [
    el("div", { class: "fig-preview-shell" }, [
      el("aside", {}, [
        el("h1", {}, [text("Pages")]),
        el("ul", { class: "fig-preview-nav" }, navItems),
        el("h1", { style: "margin-top: 24px" }, [text("View")]),
        el("div", { class: "fig-preview-nav" }, [
          el("button", { type: "button", "data-fig-mode": "side", "aria-current": "true" }, [text("Side by side")]),
          el("button", { type: "button", "data-fig-mode": "overlay", "aria-current": "false" }, [text("Overlay")]),
        ]),
      ]),
      el("main", { class: "fig-preview-main fig-preview-main--side", id: "fig-main" }, [
        el("section", { class: "fig-preview-pane" }, [
          el("header", {}, [text("Figma source (SVG)")]),
          el("div", { class: "fig-preview-stage", id: "fig-figma-stage" }, [
            el("img", { id: "fig-figma-frame", alt: "Exported Figma SVG" }),
            loadingOverlay("fig-figma-loading"),
          ]),
        ]),
        el("section", { class: "fig-preview-pane" }, [
          el("header", {}, [text("React output (page)")]),
          el("div", { class: "fig-preview-stage", id: "fig-react-stage" }, [
            el("iframe", { id: "fig-react-frame", title: "Generated web page" }),
            loadingOverlay("fig-react-loading"),
          ]),
        ]),
      ]),
    ]),
    el("script", {}, [raw(buildShellScript(frames))]),
  ];
  const document: HtmlNode[] = [
    doctype(),
    el("html", { lang: "en" }, [el("head", {}, head), el("body", {}, body)]),
  ];
  return `${serialize(document)}\n`;
}

/**
 * Start a lazy preview server. Returns once it is listening; the caller
 * keeps the process alive (the server runs until interrupted).
 */
export async function startPreviewServer(args: StartPreviewServerArgs): Promise<ServeHandle> {
  if (typeof Bun === "undefined" || typeof Bun.serve !== "function") {
    throw new Error("fig-to-web --serve requires Bun (Bun.serve). Run via `bun run`.");
  }
  const { source, frames, options, output } = args;
  const workDir = resolve(options.out);
  await mkdir(workDir, { recursive: true });

  const session = createEmitSession(source, frames, emitOptionsFrom(options));
  const targets = [...session.registry.frames.values()];
  const descriptors = targets.map(describeFrame);
  const shellHtml = buildShellHtml(descriptors);

  const frameBySvgSlug = new Map(targets.map((t): [string, FrameTarget] => [svgSlugFor(t), t]));
  const frameByRoute = new Map(targets.map((t): [string, FrameTarget] => [`${t.canvasSlug}/${t.slug}`, t]));

  const writtenAssetPaths = new Set<string>();
  const writtenComponentPaths = new Set<string>();
  const pageJobs = new Map<string, Promise<void>>();
  const svgJobs = new Map<string, Promise<string>>();

  async function writeEmitFile(file: EmitFile): Promise<void> {
    const full = resolve(workDir, file.path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, file.contents, "utf-8");
  }

  async function writeNewAssets(): Promise<void> {
    for (const asset of session.imageRegistry.collected()) {
      if (writtenAssetPaths.has(asset.path)) {
        continue;
      }
      const full = resolve(workDir, asset.path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, asset.bytes);
      writtenAssetPaths.add(asset.path);
    }
    for (const asset of session.iconRegistry?.collected() ?? []) {
      if (writtenAssetPaths.has(asset.path)) {
        continue;
      }
      await writeEmitFile({ path: asset.path, contents: asset.contents });
      writtenAssetPaths.add(asset.path);
    }
  }

  // external-css collects rules into the shared registry as pages emit;
  // re-render the single root stylesheet so the standalone bundle's
  // `import "./styles.css"` (which Bun resolves from disk) sees this
  // page's rules. Inline / css-modules modes leave the registry unset
  // and this is a no-op.
  async function refreshExternalStylesheet(): Promise<void> {
    if (!session.externalCssRegistry) {
      return;
    }
    const stylesheet = session.externalCssRegistry.renderStylesheet(session.opts.externalStylesheetPath);
    if (!stylesheet) {
      return;
    }
    await writeEmitFile(stylesheet);
  }

  async function emitPageArtifacts(target: FrameTarget): Promise<void> {
    for (const file of emitPageFile(source, session.registry, session.tokenIndex, target, session.opts)) {
      await writeEmitFile(file);
    }
    for (const component of collectReferencedComponentTargets(source, session.registry, target.node)) {
      if (writtenComponentPaths.has(component.filePath)) {
        continue;
      }
      for (const file of emitComponentFile(source, session.registry, session.tokenIndex, component, session.opts)) {
        await writeEmitFile(file);
      }
      writtenComponentPaths.add(component.filePath);
    }
    await refreshExternalStylesheet();
    await writeNewAssets();
    for (const file of emitStandaloneFiles(target, session.fontPlan)) {
      await writeEmitFile(file);
    }
    const entry = resolve(workDir, `pages/${target.canvasSlug}/${target.slug}/standalone.tsx`);
    await bundleEntrypoints(workDir, [entry]);
  }

  function frameLabel(target: FrameTarget): string {
    return target.node.name ?? target.componentName;
  }

  function ensurePage(target: FrameTarget): Promise<void> {
    const existing = pageJobs.get(target.filePath);
    if (existing) {
      return existing;
    }
    output.info(`  generating page: ${frameLabel(target)} (emit + bundle) …`);
    const job = emitPageArtifacts(target);
    pageJobs.set(target.filePath, job);
    return job;
  }

  // The exported SVG is served verbatim and shown in an `<img>`: the
  // renderer outlines glyphs to vector `<path>`s, so the file is fully
  // self-contained — no web fonts, no scripts, no external refs. We add
  // nothing to it (an earlier `@import` injection both broke XML
  // well-formedness and was pointless once text is paths).
  function ensureSvg(target: FrameTarget): Promise<string> {
    const existing = svgJobs.get(target.filePath);
    if (existing) {
      return existing;
    }
    output.info(`  rendering Figma SVG: ${frameLabel(target)} …`);
    const job = renderFrameSvg(source, target).then(async (svg) => {
      await writeEmitFile({ path: `figma/${svgSlugFor(target)}.svg`, contents: svg });
      return svg;
    });
    svgJobs.set(target.filePath, job);
    return job;
  }

  function respond(body: string | Uint8Array<ArrayBuffer>, contentType: string, status = 200): Response {
    return new Response(body, {
      status,
      headers: { "Content-Type": contentType, "cache-control": "no-store" },
    });
  }

  async function serveStatic(relPath: string): Promise<Response> {
    const candidate = resolve(workDir, relPath);
    if (!isInside(workDir, candidate)) {
      return respond("forbidden", "text/plain; charset=utf-8", 403);
    }
    const info = await stat(candidate).then((s) => s, () => undefined);
    if (!info || !info.isFile()) {
      return respond("not found", "text/plain; charset=utf-8", 404);
    }
    const bytes = new Uint8Array(await readFile(candidate));
    return respond(bytes, contentTypeFor(candidate));
  }

  function notFound(): Response {
    return respond("not found", "text/plain; charset=utf-8", 404);
  }

  async function routeSvg(slug: string): Promise<Response> {
    const target = frameBySvgSlug.get(slug);
    if (!target) {
      return notFound();
    }
    const svg = await ensureSvg(target);
    return respond(svg, "image/svg+xml; charset=utf-8");
  }

  async function routePage(canvas: string, slug: string, rest: string): Promise<Response> {
    const target = frameByRoute.get(`${canvas}/${slug}`);
    if (!target) {
      return notFound();
    }
    // A standalone page lives three levels deep, so its emitted
    // `./assets/...` URLs arrive here as `assets/<rest>`. Those resolve
    // to the single shared root `assets/` directory, not a per-page one.
    // Ensure the owning page is emitted first so its assets exist.
    const assetPrefix = "assets/";
    if (rest.startsWith(assetPrefix)) {
      await ensurePage(target);
      return serveStatic(`assets/${rest.slice(assetPrefix.length)}`);
    }
    await ensurePage(target);
    const file = rest === "" ? "index.html" : rest;
    return serveStatic(`pages/${canvas}/${slug}/${file}`);
  }

  async function route(path: string): Promise<Response> {
    if (path === "/" || path === "/index.html") {
      return respond(shellHtml, "text/html; charset=utf-8");
    }
    // The preview ships no favicon; answer the browser's automatic
    // request explicitly so it doesn't surface as a 404 in the console.
    if (path === "/favicon.ico") {
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    }
    if (path === "/tokens.css") {
      return respond(session.tokensFile.contents, "text/css; charset=utf-8");
    }
    const svgMatch = /^\/figma\/(.+)\.svg$/.exec(path);
    if (svgMatch) {
      return routeSvg(svgMatch[1] ?? "");
    }
    // Root-level asset reference (rare — nothing at the root links one,
    // but kept so a hand-typed `/assets/...` URL still resolves).
    if (path.startsWith("/assets/")) {
      return serveStatic(path.slice(1));
    }
    const pageMatch = /^\/pages\/([^/]+)\/([^/]+)\/(.*)$/.exec(path);
    if (pageMatch) {
      return routePage(pageMatch[1] ?? "", pageMatch[2] ?? "", pageMatch[3] ?? "");
    }
    return serveStatic(path.replace(/^\//, ""));
  }

  const server = Bun.serve({
    port: options.port,
    fetch: async (req: Request) => {
      const url = new URL(req.url);
      const path = decodeURIComponent(url.pathname);
      try {
        return await route(path);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.error(`fig-to-web --serve: failed to generate ${path}:\n${message}`);
        return respond(`fig-to-web preview generation failed for ${path}:\n${message}`, "text/plain; charset=utf-8", 500);
      }
    },
  });

  return { port: server.port, stop: () => server.stop() };
}
