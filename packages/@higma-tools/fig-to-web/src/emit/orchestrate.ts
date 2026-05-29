/**
 * @file Top-level orchestration for the JSX/CSS emit pipeline.
 *
 * Given a fig source plus a list of target frames, produce the full
 * set of files that should land in the output directory:
 *
 *   - one TSX per page (`pages/<canvas>/<frame>.tsx`)
 *   - one TSX per referenced component (`components/<canvas>/<set>.tsx`)
 *   - the design-token CSS file (`tokens.css`)
 *   - a browser-runnable preview (`index.html` + `main.tsx` +
 *     `App.tsx`) so consumers can verify the result without
 *     bootstrapping a separate React project
 *   - an `index.ts` that re-exports each generated page for
 *     programmatic embedding in larger codebases
 *
 * The preview triple is the answer to "I want to see what this looks
 * like in a browser without writing a package.json": dropping the
 * output into any static server (or `bun out/index.html`) renders
 * a sidebar of all generated pages with one click each. React itself
 * is loaded via an importmap pointing at esm.sh so no node_modules /
 * build step is required by the consumer of the output.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { buildWebFontPlan, collectFontQueries, type WebFontPlan } from "@higma-document-models/fig/font";
import type { FigDocumentContext } from "@higma-document-io/fig/context";
import type { EmitFile, EmitRegistry, FrameTarget } from "./types";
import { buildRegistry } from "./plan/registry";
import { emitComponentFile, emitPageFile } from "./render/files";
import type { EmitOpts } from "./render/files";
import { buildTokensFromFrames, tokensToCss } from "../tokens";
import type { TokenIndex } from "../tokens";
import { createImageRegistry } from "./assets/images";
import type { ImageRegistry } from "./assets/images";
import { emitFigmaSvgForFrame } from "./figma-export/figma-svg";
import { renderFontLinkNodes } from "./font-links";
import { doctype, el, raw, text } from "../lib/html-tree/builder";
import { serialize } from "../lib/html-tree/serialize";
import type { HtmlNode } from "../lib/html-tree/types";
import { createExternalCssRegistry, type ExternalCssRegistry } from "./style/strategy/external-css";
import { createIconRegistry, type IconRegistry } from "./assets/icons";

const EXTERNAL_STYLESHEET_PATH = "styles.css";

export type EmitResult = {
  readonly files: readonly EmitFile[];
  readonly registry: EmitRegistry;
  /**
   * Binary assets (images) referenced by emitted JSX. Each entry has a
   * relative path (`assets/<hash>.<ext>`) and the bytes the caller
   * must write to disk so `<img>` / `background-image: url(...)`
   * references resolve.
   */
  readonly assets: readonly { readonly path: string; readonly bytes: Uint8Array }[];
};

function emitIndexFile(registry: EmitRegistry): EmitFile {
  const lines: string[] = [
    "/**",
    " * @file Generated entry — re-exports every page produced from the source fig.",
    " */",
    "",
  ];
  const sorted = [...registry.frames.values()].sort((a, b) =>
    a.componentName.localeCompare(b.componentName),
  );
  for (const target of sorted) {
    const importPath = `./${target.filePath.replace(/\.tsx$/, "")}`;
    lines.push(`export { ${target.componentName} } from ${JSON.stringify(importPath)};`);
  }
  lines.push("");
  return { path: "index.ts", contents: lines.join("\n") };
}

function emitTokensFile(source: FigDocumentContext, frames: readonly FigNode[]): {
  readonly file: EmitFile;
  readonly registryInputs: ReturnType<typeof buildTokensFromFrames>;
} {
  const built = buildTokensFromFrames(source, frames);
  const css = tokensToCss(built.tokens);
  return {
    file: { path: "tokens.css", contents: css },
    registryInputs: built,
  };
}

const IMPORT_MAP_JSON = [
  "{",
  `  "imports": {`,
  `    "react": "https://esm.sh/react@19.2.4",`,
  `    "react/jsx-runtime": "https://esm.sh/react@19.2.4/jsx-runtime",`,
  `    "react/jsx-dev-runtime": "https://esm.sh/react@19.2.4/jsx-dev-runtime",`,
  `    "react-dom/client": "https://esm.sh/react-dom@19.2.4/client"`,
  "  }",
  "}",
].join("\n");

function emitIndexHtml(fontPlan: WebFontPlan): EmitFile {
  const head: HtmlNode[] = [
    el("meta", { charset: "utf-8" }),
    el("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
    el("title", {}, [text("fig-to-web preview")]),
    ...renderFontLinkNodes(fontPlan),
    el("link", { rel: "stylesheet", href: "./tokens.css" }),
    el("link", { rel: "stylesheet", href: "./preview.css" }),
    el("script", { type: "importmap" }, [raw(IMPORT_MAP_JSON)]),
  ];
  const body: HtmlNode[] = [
    el("div", { id: "root" }),
    el("script", { type: "module", src: "./main.js" }),
  ];
  const document: HtmlNode[] = [
    doctype(),
    el("html", { lang: "en" }, [
      el("head", {}, head),
      el("body", {}, body),
    ]),
  ];
  return { path: "index.html", contents: `${serialize(document)}\n` };
}

/**
 * Walk the source's TEXT nodes (and INSTANCE-resolved SYMBOLs) to
 * collect the exact (family, weight, style) the rendered output
 * actually needs, then turn that into a `WebFontPlan` whose Google
 * Fonts URL only requests those weights — never a 100..900 sweep.
 */
export function buildSourceFontPlan(source: FigDocumentContext, frames: readonly FigNode[]): WebFontPlan {
  const { queries } = collectFontQueries({
    roots: frames,
    symbolResolver: source.symbolResolver,
    childrenOf: source.document.childrenOf,
  });
  return buildWebFontPlan(queries);
}

function emitPreviewCss(): EmitFile {
  const css = [
    `html, body, #root { margin: 0; padding: 0; height: 100%; }`,
    `body { font-family: system-ui, sans-serif; background: #1a1a1a; color: #f4f4f4; }`,
    `.fig-preview-shell { display: flex; height: 100vh; }`,
    `.fig-preview-shell aside {`,
    `  flex: 0 0 220px; overflow-y: auto;`,
    `  background: #111; border-right: 1px solid #2a2a2a;`,
    `  padding: 16px 0;`,
    `}`,
    `.fig-preview-shell aside h1 {`,
    `  font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;`,
    `  color: #888; margin: 0 0 8px 16px;`,
    `}`,
    `.fig-preview-shell aside ul { list-style: none; margin: 0; padding: 0; }`,
    `.fig-preview-shell aside li button {`,
    `  display: block; width: 100%; text-align: left; background: none;`,
    `  border: 0; color: inherit; padding: 8px 16px; cursor: pointer;`,
    `  font: inherit;`,
    `}`,
    `.fig-preview-shell aside li button:hover { background: #1f1f1f; }`,
    `.fig-preview-shell aside li button[aria-current="true"] {`,
    `  background: #2962ff; color: #fff;`,
    `}`,
    `.fig-preview-modes button {`,
    `  display: block; width: 100%; text-align: left; background: none;`,
    `  border: 0; color: inherit; padding: 8px 16px; cursor: pointer;`,
    `  font: inherit;`,
    `}`,
    `.fig-preview-modes button:hover { background: #1f1f1f; }`,
    `.fig-preview-modes button[aria-current="true"] { background: #2962ff; color: #fff; }`,
    `.fig-preview-main { flex: 1; overflow: auto; padding: 32px; }`,
    `.fig-preview-main--side {`,
    `  display: flex; flex-direction: row; gap: 32px; align-items: flex-start; justify-content: flex-start;`,
    `}`,
    `.fig-preview-main--overlay {`,
    `  display: grid; place-items: start center;`,
    `}`,
    `.fig-preview-main--overlay .fig-preview-pane:first-child .fig-preview-stage,`,
    `.fig-preview-main--overlay .fig-preview-pane:last-child .fig-preview-stage {`,
    `  grid-area: 1 / 1;`,
    `}`,
    `.fig-preview-main--overlay .fig-preview-pane { grid-area: 1 / 1; }`,
    `.fig-preview-main--overlay .fig-preview-pane:last-child .fig-preview-stage {`,
    `  mix-blend-mode: difference;`,
    `}`,
    `.fig-preview-pane header {`,
    `  font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;`,
    `  color: #888; margin-bottom: 8px;`,
    `}`,
    `.fig-preview-stage {`,
    `  background: #fff; color: #000;`,
    `  box-shadow: 0 2px 24px rgba(0, 0, 0, 0.4);`,
    `  position: relative; overflow: hidden;`,
    `}`,
    `.fig-preview-stage iframe { border: 0; display: block; }`,
    ``,
  ].join("\n");
  return { path: "preview.css", contents: css };
}

/**
 * Build a standalone HTML + entry-tsx pair for a single frame.
 *
 * The resulting `pages/<canvasSlug>/<slug>/index.html` mounts ONLY
 * the React component for the frame, with the same fonts and tokens
 * the dual-pane preview uses. The verifier hits this URL in
 * Chromium to screenshot exactly what a downstream consumer would
 * see when they render the emitted React output — independent of
 * the dual-pane dev shell (which exists for human comparison, not
 * automated diffing).
 */
export function emitStandaloneFiles(target: FrameTarget, fontPlan: WebFontPlan): readonly EmitFile[] {
  const baseDir = `pages/${target.canvasSlug}/${target.slug}`;
  const htmlPath = `${baseDir}/index.html`;
  const entryPath = `${baseDir}/standalone.tsx`;
  // The entry tsx imports the generated page component via a
  // relative path that climbs from `pages/<canvas>/<slug>/` back to
  // `pages/<canvas>/<slug>.tsx`.
  const componentImport = `../${target.slug}`;
  const entryCode = [
    `/**`,
    ` * @file Standalone entry for the "${target.componentName}" frame.`,
    ` *`,
    ` * Mounts the generated React component on its own page so the`,
    ` * verifier can screenshot the React render directly. The dual-pane`,
    ` * preview shell remains the human-facing UI.`,
    ` */`,
    `import { StrictMode } from "react";`,
    `import { createRoot } from "react-dom/client";`,
    `import { ${target.componentName} } from ${JSON.stringify(componentImport)};`,
    ``,
    `const container = document.getElementById("root");`,
    `if (!container) {`,
    `  throw new Error("standalone preview: #root element missing");`,
    `}`,
    `createRoot(container).render(<StrictMode><${target.componentName} /></StrictMode>);`,
    ``,
  ].join("\n");
  const entryFile: EmitFile = { path: entryPath, contents: entryCode };

  // The HTML resolves tokens.css / preview.css from the output root —
  // standalone pages live three levels deep so the relative root is
  // `../../../`.
  const head: HtmlNode[] = [
    el("meta", { charset: "utf-8" }),
    el("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
    el("title", {}, [text(`fig-to-web · ${target.node.name ?? target.componentName}`)]),
    ...renderFontLinkNodes(fontPlan),
    el("link", { rel: "stylesheet", href: "../../../tokens.css" }),
    el("script", { type: "importmap" }, [raw(IMPORT_MAP_JSON)]),
  ];
  const body: HtmlNode[] = [
    el("div", { id: "root" }),
    el("script", { type: "module", src: "./standalone.js" }),
  ];
  const document: HtmlNode[] = [
    doctype(),
    el("html", { lang: "en" }, [
      el("head", {}, head),
      el("body", { style: "margin:0;padding:0;background:#fff;color:#000" }, body),
    ]),
  ];
  const htmlFile: EmitFile = { path: htmlPath, contents: `${serialize(document)}\n` };
  return [entryFile, htmlFile];
}

function emitMainTsx(): EmitFile {
  const code = [
    `/**`,
    ` * @file Browser entry — boots React and mounts the preview shell.`,
    ` *`,
    ` * Stylesheets (tokens.css + preview.css) are linked directly from`,
    ` * index.html so the bundle stays JS-only.`,
    ` */`,
    `import { StrictMode } from "react";`,
    `import { createRoot } from "react-dom/client";`,
    `import { App } from "./App";`,
    ``,
    `const container = document.getElementById("root");`,
    `if (!container) {`,
    `  throw new Error("fig-to-web preview: #root element missing in index.html");`,
    `}`,
    `createRoot(container).render(<StrictMode><App /></StrictMode>);`,
    ``,
  ].join("\n");
  return { path: "main.tsx", contents: code };
}

type AppEntryDescriptor = {
  readonly target: FrameTarget;
  readonly figmaSlug: string | undefined;
};

function formatSizeLiteral(target: FrameTarget): string {
  if (!target.node.size) {
    return "undefined";
  }
  return `{ width: ${target.node.size.x}, height: ${target.node.size.y} }`;
}

function emitAppTsx(entries: readonly AppEntryDescriptor[]): EmitFile {
  const sorted = [...entries].sort((a, b) =>
    a.target.componentName.localeCompare(b.target.componentName),
  );
  const importLines = sorted.map(({ target }) => {
    const path = `./${target.filePath.replace(/\.tsx$/, "")}`;
    return `import { ${target.componentName} } from ${JSON.stringify(path)};`;
  });
  const entryLines = sorted.map(({ target, figmaSlug }) => {
    const figma = figmaSlug ? JSON.stringify(`./figma/${figmaSlug}.html`) : "undefined";
    const size = formatSizeLiteral(target);
    return `  { id: ${JSON.stringify(target.componentName)}, label: ${JSON.stringify(target.node.name ?? target.componentName)}, Component: ${target.componentName}, figmaSrc: ${figma}, size: ${size} },`;
  });
  const code = [
    `/**`,
    ` * @file Preview shell — Figma render (left, iframe) vs the`,
    ` * generated React render (right). The two surfaces share the`,
    ` * frame's authored width / height so any pixel offset shows up`,
    ` * directly. Plain React state, no router dependency.`,
    ` */`,
    `import { useState } from "react";`,
    ...importLines,
    ``,
    `type Entry = {`,
    `  id: string;`,
    `  label: string;`,
    `  Component: () => React.ReactElement;`,
    `  figmaSrc: string | undefined;`,
    `  size: { width: number; height: number } | undefined;`,
    `};`,
    ``,
    `const entries: Entry[] = [`,
    ...entryLines,
    `];`,
    ``,
    `type ViewMode = "side" | "overlay";`,
    ``,
    `export function App(): React.ReactElement {`,
    `  const initial = entries[0]?.id;`,
    `  const [activeId, setActiveId] = useState<string | undefined>(initial);`,
    `  const [mode, setMode] = useState<ViewMode>("side");`,
    `  const active = entries.find((e) => e.id === activeId) ?? entries[0];`,
    `  if (!active) {`,
    `    return <p style={{ padding: 32 }}>No pages generated.</p>;`,
    `  }`,
    `  const ActiveComponent = active.Component;`,
    `  const stageSize = active.size ?? { width: 1024, height: 768 };`,
    `  const stageStyle: React.CSSProperties = { width: stageSize.width, height: stageSize.height };`,
    `  return (`,
    `    <div className="fig-preview-shell">`,
    `      <aside>`,
    `        <h1>Pages</h1>`,
    `        <ul>`,
    `          {entries.map((entry) => (`,
    `            <li key={entry.id}>`,
    `              <button`,
    `                type="button"`,
    `                aria-current={entry.id === active.id ? "true" : undefined}`,
    `                onClick={() => setActiveId(entry.id)}`,
    `              >`,
    `                {entry.label}`,
    `              </button>`,
    `            </li>`,
    `          ))}`,
    `        </ul>`,
    `        <h1 style={{ marginTop: 24 }}>View</h1>`,
    `        <div className="fig-preview-modes">`,
    `          <button type="button" aria-current={mode === "side" ? "true" : undefined} onClick={() => setMode("side")}>Side by side</button>`,
    `          <button type="button" aria-current={mode === "overlay" ? "true" : undefined} onClick={() => setMode("overlay")}>Overlay</button>`,
    `        </div>`,
    `      </aside>`,
    `      <main className={\`fig-preview-main fig-preview-main--\${mode}\`}>`,
    `        <section className="fig-preview-pane">`,
    `          <header>Figma source</header>`,
    `          <div className="fig-preview-stage" style={stageStyle}>`,
    `            {active.figmaSrc ? (`,
    `              <iframe title={\`Figma render of \${active.label}\`} src={active.figmaSrc} style={stageStyle} />`,
    `            ) : (`,
    `              <p style={{ padding: 24 }}>No Figma SVG available for this frame.</p>`,
    `            )}`,
    `          </div>`,
    `        </section>`,
    `        <section className="fig-preview-pane">`,
    `          <header>React output</header>`,
    `          <div className="fig-preview-stage" style={stageStyle}>`,
    `            <ActiveComponent />`,
    `          </div>`,
    `        </section>`,
    `      </main>`,
    `    </div>`,
    `  );`,
    `}`,
    ``,
    `export default App;`,
    ``,
  ].join("\n");
  return { path: "App.tsx", contents: code };
}

/**
 * How CSS is delivered to the consumer.
 *
 * - `"inline"`: every emitted element carries `style={{ ... }}` directly
 *   (the only mode implemented today). The token sheet (`tokens.css`)
 *   still carries design-token CSS custom properties because `var(--…)`
 *   references are present in the inline style values.
 * - `"css-modules"`: each generated component emits a sibling
 *   `*.module.css` file. The TSX side reads class names via
 *   `import classes from "./X.module.css"` and uses `aria-*` /
 *   `data-state-*` attribute selectors for variant state. Not yet
 *   implemented — throws at the boundary so partial behaviour can't
 *   masquerade as success.
 * - `"external-css"`: one global stylesheet with BEM-style class
 *   names; TSX may opt-in to `import "./styles.css"` (`cssImport:
 *   "direct"`) or rely on the consumer to wire it up (`"external"`).
 *   Not yet implemented.
 * - `"tailwind"`: utility class names in `className`. Requires
 *   token → Tailwind config mapping. Not yet implemented.
 */
export type CssMode = "inline" | "css-modules" | "external-css" | "tailwind";

/**
 * How a TSX file references the global stylesheet emitted by
 * `cssMode: "external-css"`. Has no effect for other CSS modes.
 *
 * - `"direct"` (default): each TSX file emits `import "./styles.css";`
 *   as a side-effect import so a bundler / dev server loads the
 *   stylesheet automatically.
 * - `"external"`: TSX files emit no stylesheet import. The consumer
 *   wires `styles.css` into their own application shell (e.g. a
 *   global `<link rel="stylesheet">` in the host page).
 */
export type CssImportStrategy = "direct" | "external";

/**
 * React component export shape.
 *
 * - `"function-default"`: emits both `export function ComponentName(
 *   ...)` (named) AND `export default ComponentName;` so consumers
 *   can import either way. This is what every prior revision produced.
 * - `"const-named"`: emits only `export const ComponentName = (...):
 *   React.ReactElement => { ... };`. No default export. Preferred for
 *   tree-shake-friendly libraries and matches the user's explicit
 *   request for the `export const ComponentName` form.
 */
export type ExportStyle = "function-default" | "const-named";

/**
 * Asset-output strategy for vector-shaped subtrees.
 *
 * - `"inline"` (default): vector subtrees stay as inline `<svg>` in
 *   the generated JSX, regardless of complexity. Preserves the
 *   historical emit shape.
 * - `"externalize-complex"`: vector subtrees whose complexity score
 *   crosses `assetComplexityThreshold` are externalised to
 *   `assets/icons/<slug>.svg` and referenced via `<img src="…" />`.
 *   Smaller subtrees stay inline. Uses the shared scorer from
 *   `@higma-document-renderers/fig/asset-plan` so the decision
 *   matches fig-to-swiftui's rasterisation gate.
 */
export type AssetStrategy = "inline" | "externalize-complex";

/**
 * How a Figma Variant Set lands in the generated React output.
 *
 * - `"discriminated"` (default): one component per Variant Set,
 *   discriminating on a `variant` prop via a `switch` statement.
 *   Compact and matches the historical emit shape.
 * - `"exploded"`: emit one standalone component per variant
 *   (`ButtonOn.tsx`, `ButtonOff.tsx`, …) plus a thin barrel
 *   (`Button.tsx`) that re-exports each variant and provides a
 *   `Button` switcher for callers that want runtime selection.
 *   Matches the user's request to treat each variant as its own
 *   first-class React component for direct import and tree-shaking.
 */
export type VariantStrategy = "discriminated" | "exploded";

/** Options controlling emission output. */
export type EmitFromFramesOptions = {
  /** Emit `data-fig-name` / `data-fig-type` attrs on every node. Default: false. */
  readonly debugAttrs?: boolean;
  /**
   * CSS delivery strategy. Default: `"inline"`. Tailwind is part of
   * the API contract but not yet implemented; passing it raises at
   * the boundary rather than silently degrading.
   */
  readonly cssMode?: CssMode;
  /**
   * Stylesheet-import strategy when `cssMode === "external-css"`.
   * Default: `"direct"`. Ignored for other CSS modes.
   */
  readonly cssImport?: CssImportStrategy;
  /**
   * React export shape. Default: `"function-default"` (preserves the
   * previous emit so existing consumers and the generated preview
   * shell keep working).
   */
  readonly exportStyle?: ExportStyle;
  /**
   * Variant Set emit strategy. Default: `"discriminated"` (single
   * component switching on `variant` prop). `"exploded"` emits one
   * standalone component per variant alongside a thin barrel that
   * re-exports them.
   */
  readonly variantStrategy?: VariantStrategy;
  /**
   * Asset-output strategy for vector subtrees. Default: `"inline"`.
   * Pair with `assetComplexityThreshold` to tune the
   * inline-vs-externalise cutover for `"externalize-complex"`.
   */
  readonly assetStrategy?: AssetStrategy;
  /**
   * Complexity threshold above which a vector subtree externalises
   * to `assets/icons/<slug>.svg`. Only consulted when
   * `assetStrategy === "externalize-complex"`. Default: 200, matching
   * the empirical value fig-to-swiftui uses for its rasterisation
   * decision so the two emitters cross over at the same node.
   */
  readonly assetComplexityThreshold?: number;
};

/**
 * Pre-validated options with defaults resolved. Internal modules
 * (`render/files.ts`) take this shape so they don't repeat the
 * defaulting / validation work.
 */
export type ResolvedEmitOptions = {
  readonly debugAttrs: boolean;
  readonly cssMode: CssMode;
  readonly cssImport: CssImportStrategy;
  readonly exportStyle: ExportStyle;
  readonly variantStrategy: VariantStrategy;
  readonly assetStrategy: AssetStrategy;
  readonly assetComplexityThreshold: number;
};

function resolveOptions(options: EmitFromFramesOptions): ResolvedEmitOptions {
  const cssMode = options.cssMode ?? "inline";
  // All four declared modes are now implemented. The guard remains
  // structurally so a future addition to the `CssMode` union has to
  // touch this file before the orchestrator silently accepts it.
  if (
    cssMode !== "inline"
    && cssMode !== "css-modules"
    && cssMode !== "external-css"
    && cssMode !== "tailwind"
  ) {
    throw new Error(`fig-to-web: cssMode "${cssMode}" is not a recognised strategy.`);
  }
  const cssImport = options.cssImport ?? "direct";
  const exportStyle = options.exportStyle ?? "function-default";
  const variantStrategy = options.variantStrategy ?? "discriminated";
  if (variantStrategy !== "discriminated" && variantStrategy !== "exploded") {
    throw new Error(`fig-to-web: variantStrategy "${variantStrategy}" is not a recognised value.`);
  }
  const assetStrategy = options.assetStrategy ?? "inline";
  if (assetStrategy !== "inline" && assetStrategy !== "externalize-complex") {
    throw new Error(`fig-to-web: assetStrategy "${assetStrategy}" is not a recognised value.`);
  }
  const assetComplexityThreshold = options.assetComplexityThreshold ?? 200;
  if (!Number.isFinite(assetComplexityThreshold) || assetComplexityThreshold < 0) {
    throw new Error(
      `fig-to-web: assetComplexityThreshold must be a non-negative finite number, got ${assetComplexityThreshold}`,
    );
  }
  return {
    debugAttrs: options.debugAttrs ?? false,
    cssMode,
    cssImport,
    exportStyle,
    variantStrategy,
    assetStrategy,
    assetComplexityThreshold,
  };
}

/**
 * Shared, render-free state for an emit run.
 *
 * Holds everything derived from `(source, frames, options)` that does
 * not itself produce output bytes: the resolved options, the global
 * registry (whose name/path dedup MUST be computed once for the whole
 * frame set so cross-page component imports resolve consistently), the
 * token index + serialised `tokens.css`, the document-wide font plan,
 * and the shared asset / CSS collectors threaded through every page
 * and component emit.
 *
 * Both the eager `emitFromFrames` and the `--serve` lazy preview build
 * one session up front, then call `emitPageFile` / `emitComponentFile`
 * / `emitFigmaSvgForFrame` against it — the serve path simply does so
 * per frame, on demand, instead of in a single pass.
 */
export type EmitSession = {
  readonly resolved: ResolvedEmitOptions;
  readonly registry: EmitRegistry;
  readonly tokenIndex: TokenIndex;
  /** Serialised `tokens.css` — `{ path: "tokens.css", contents }`. */
  readonly tokensFile: EmitFile;
  readonly fontPlan: WebFontPlan;
  readonly imageRegistry: ImageRegistry;
  readonly externalCssRegistry: ExternalCssRegistry | undefined;
  readonly iconRegistry: IconRegistry | undefined;
  readonly opts: EmitOpts;
};

/**
 * Build the shared emit session (see {@link EmitSession}). Pure setup —
 * no output files, no SVG render, no bundling.
 */
export function createEmitSession(
  source: FigDocumentContext,
  frames: readonly FigNode[],
  options: EmitFromFramesOptions = {},
): EmitSession {
  const resolved = resolveOptions(options);
  const tokens = emitTokensFile(source, frames);
  const registry = buildRegistry(source, frames);
  const imageRegistry = createImageRegistry(source.images);
  // The external-css strategy needs one registry shared across every
  // component/page emit because all generated TSX files reference a
  // single `styles.css` at the output root. The registry stays
  // unused (and `undefined`) for other CSS modes so per-file
  // collectors continue to own their own scope.
  const externalCssRegistry: ExternalCssRegistry | undefined =
    resolved.cssMode === "external-css" ? createExternalCssRegistry() : undefined;
  // Icon registry lives at the orchestrator level so externalised
  // SVGs from any component / page share one `assets/icons/` directory
  // and dedupe on guid. Skip creating it for `inline` mode so the
  // EmitContext branch that consults it short-circuits cleanly.
  const iconRegistry: IconRegistry | undefined =
    resolved.assetStrategy === "externalize-complex" ? createIconRegistry() : undefined;
  const opts: EmitOpts = {
    debugAttrs: resolved.debugAttrs,
    exportStyle: resolved.exportStyle,
    cssMode: resolved.cssMode,
    cssImport: resolved.cssImport,
    variantStrategy: resolved.variantStrategy,
    assetStrategy: resolved.assetStrategy,
    assetComplexityThreshold: resolved.assetComplexityThreshold,
    imageResolver: imageRegistry.resolve,
    externalCssRegistry,
    externalStylesheetPath: EXTERNAL_STYLESHEET_PATH,
    iconRegistry,
  };
  return {
    resolved,
    registry,
    tokenIndex: tokens.registryInputs.index,
    tokensFile: tokens.file,
    fontPlan: buildSourceFontPlan(source, frames),
    imageRegistry,
    externalCssRegistry,
    iconRegistry,
    opts,
  };
}

/**
 * Drive the full emission for a fixed set of target frames.
 *
 * Returns the in-memory file set without touching disk; the caller
 * (CLI runtime or programmatic consumer) decides where to write.
 *
 * Async because the authoritative Figma SVG render emitted alongside
 * the React output (`emitFigmaSvgForFrame`) goes through the scene
 * graph builder, whose font / image decode steps are async.
 */
export async function emitFromFrames(
  source: FigDocumentContext,
  frames: readonly FigNode[],
  options: EmitFromFramesOptions = {},
): Promise<EmitResult> {
  const session = createEmitSession(source, frames, options);
  const { registry, opts, fontPlan, imageRegistry, externalCssRegistry, iconRegistry } = session;

  const files: EmitFile[] = [session.tokensFile];

  for (const target of registry.frames.values()) {
    for (const file of emitPageFile(source, registry, session.tokenIndex, target, opts)) {
      files.push(file);
    }
  }
  for (const target of registry.components.values()) {
    for (const file of emitComponentFile(source, registry, session.tokenIndex, target, opts)) {
      files.push(file);
    }
  }

  // Render the single sidecar stylesheet for external-css mode. The
  // file lives at the output root so every TSX `import "./..styles.css"`
  // resolves against the same target (`relativeStylesheetSpecifier`
  // produces the correct number of `../` jumps per page depth).
  if (externalCssRegistry) {
    const stylesheet = externalCssRegistry.renderStylesheet(EXTERNAL_STYLESHEET_PATH);
    if (stylesheet) {
      files.push(stylesheet);
    }
  }

  const figmaPairs = await Promise.all(
    [...registry.frames.values()].map(async (target) => ({
      target,
      figma: await emitFigmaSvgForFrame(source, target, fontPlan),
    })),
  );
  for (const { figma } of figmaPairs) {
    files.push(figma.svg);
    files.push(figma.html);
  }

  files.push(emitIndexFile(registry));
  files.push(emitIndexHtml(fontPlan));
  files.push(emitPreviewCss());
  files.push(emitMainTsx());
  files.push(emitAppTsx(figmaPairs.map(({ target, figma }) => ({ target, figmaSlug: figma.slug }))));
  // Standalone HTML + entry per frame — the React-only render path
  // the visual-fidelity verifier consumes. Distinct from the
  // dual-pane preview shell so dev humans and automation each get a
  // surface tailored to their use case.
  for (const target of registry.frames.values()) {
    for (const file of emitStandaloneFiles(target, fontPlan)) {
      files.push(file);
    }
  }

  // Icon assets (externalised vector subtrees) join the image assets
  // in `EmitResult.assets`. The icon registry stores text content but
  // the asset surface speaks Uint8Array, so encode each SVG to UTF-8
  // bytes here — the CLI writer treats both image and icon assets
  // through the same `writeFile(path, bytes)` code path.
  const iconAssets = (iconRegistry?.collected() ?? []).map((asset) => ({
    path: asset.path,
    bytes: new TextEncoder().encode(asset.contents),
  }));
  const assets = [...imageRegistry.collected(), ...iconAssets];

  return { files, registry, assets };
}

/**
 * Enumerate the standalone HTML entries produced by `emitFromFrames`.
 *
 * Returned paths are relative to the emit output root and align with
 * each frame target's `<canvasSlug>/<slug>` directory. The verifier
 * uses these to drive Chromium and pixel-diff the React render.
 */
export function listStandalonePaths(registry: EmitRegistry): readonly { readonly target: FrameTarget; readonly htmlPath: string; readonly entryPath: string }[] {
  const out: { readonly target: FrameTarget; readonly htmlPath: string; readonly entryPath: string }[] = [];
  for (const target of registry.frames.values()) {
    const base = `pages/${target.canvasSlug}/${target.slug}`;
    out.push({ target, htmlPath: `${base}/index.html`, entryPath: `${base}/standalone.tsx` });
  }
  return out;
}
