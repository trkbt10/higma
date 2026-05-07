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
import type { FigSource } from "../fig-source";
import type { EmitFile, EmitRegistry, FrameTarget } from "./types";
import { buildRegistry } from "./registry";
import { emitComponentFile, emitPageFile } from "./files";
import { buildTokensFromFrames, tokensToCss } from "../tokens";
import { createImageRegistry } from "./images";
import { emitFigmaSvgForFrame } from "./figma-svg";

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

function emitTokensFile(source: FigSource, frames: readonly FigNode[]): {
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

function emitIndexHtml(fontFamilies: readonly string[]): EmitFile {
  const fontLinks = renderFontLinks(fontFamilies);
  const html = [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `  <meta charset="utf-8" />`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `  <title>fig-to-web preview</title>`,
    ...fontLinks,
    `  <link rel="stylesheet" href="./tokens.css" />`,
    `  <link rel="stylesheet" href="./preview.css" />`,
    `  <script type="importmap">`,
    `  {`,
    `    "imports": {`,
    `      "react": "https://esm.sh/react@19.2.4",`,
    `      "react/jsx-runtime": "https://esm.sh/react@19.2.4/jsx-runtime",`,
    `      "react/jsx-dev-runtime": "https://esm.sh/react@19.2.4/jsx-dev-runtime",`,
    `      "react-dom/client": "https://esm.sh/react-dom@19.2.4/client"`,
    `    }`,
    `  }`,
    `  </script>`,
    `</head>`,
    `<body>`,
    `  <div id="root"></div>`,
    `  <script type="module" src="./main.js"></script>`,
    `</body>`,
    `</html>`,
    ``,
  ].join("\n");
  return { path: "index.html", contents: html };
}

/**
 * Build Google Fonts `<link>` elements for every distinct font family
 * referenced by typography tokens.
 *
 * Why this matters: Figma authors typically pick a specific
 * web/system font (Roboto, Inter, SF Pro, ...) and expect that font to
 * render. Without an explicit @font-face declaration the browser
 * falls back to the next entry in the font-family stack — usually
 * `system-ui` here — which renders with different metrics, breaking
 * pixel-faithful comparison against the source Figma view.
 *
 * The link uses Google Fonts' CSS2 API with a comprehensive weight
 * range so any token referencing a family resolves regardless of its
 * `fontWeight`. Families Google Fonts does not host (e.g. proprietary
 * vendor fonts) are silently skipped — the consumer still has the
 * fallback stack, and we'd rather degrade than 404.
 */
function renderFontLinks(families: readonly string[]): readonly string[] {
  if (families.length === 0) {
    return [];
  }
  const params = families
    .map((family) => `family=${encodeURIComponent(family)}:wght@100;200;300;400;500;600;700;800;900`)
    .join("&");
  const href = `https://fonts.googleapis.com/css2?${params}&display=swap`;
  return [
    `  <link rel="preconnect" href="https://fonts.googleapis.com" />`,
    `  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />`,
    `  <link rel="stylesheet" href="${href}" />`,
  ];
}

function uniqueFontFamilies(typography: ReadonlyMap<string, { readonly fontFamily: string }>): readonly string[] {
  const seen = new Set<string>();
  for (const token of typography.values()) {
    seen.add(token.fontFamily);
  }
  return [...seen].sort();
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

/** Options controlling emission output. */
export type EmitFromFramesOptions = {
  /** Emit `data-fig-name` / `data-fig-type` attrs on every node. Default: false. */
  readonly debugAttrs?: boolean;
};

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
  source: FigSource,
  frames: readonly FigNode[],
  options: EmitFromFramesOptions = {},
): Promise<EmitResult> {
  const tokens = emitTokensFile(source, frames);
  const registry = buildRegistry(source, frames);
  const imageRegistry = createImageRegistry(source.loaded.images);
  const opts = {
    debugAttrs: options.debugAttrs ?? false,
    imageResolver: imageRegistry.resolve,
  };

  const files: EmitFile[] = [tokens.file];

  for (const target of registry.frames.values()) {
    files.push(emitPageFile(source, registry, tokens.registryInputs.index, target, opts));
  }
  for (const target of registry.components.values()) {
    files.push(emitComponentFile(source, registry, tokens.registryInputs.index, target, opts));
  }

  const fontFamilies = uniqueFontFamilies(tokens.registryInputs.tokens.typography);
  const figmaPairs = await Promise.all(
    [...registry.frames.values()].map(async (target) => ({
      target,
      figma: await emitFigmaSvgForFrame(source, target, fontFamilies),
    })),
  );
  for (const { figma } of figmaPairs) {
    if (!figma) {
      continue;
    }
    files.push(figma.svg);
    files.push(figma.html);
  }

  files.push(emitIndexFile(registry));
  files.push(emitIndexHtml(fontFamilies));
  files.push(emitPreviewCss());
  files.push(emitMainTsx());
  files.push(emitAppTsx(figmaPairs.map(({ target, figma }) => ({ target, figmaSlug: figma?.slug }))));

  return { files, registry, assets: imageRegistry.collected() };
}
