/**
 * @file Render the source Figma frame as an authoritative SVG.
 *
 * The generated React page is one rendering of the fig data; the
 * authoritative one is what `@higma-document-renderers/fig` produces
 * by walking the same scene graph Figma itself uses. Emitting both
 * side by side lets the preview UI pixel-diff against the source —
 * the only credible measure of "did we match Figma?".
 *
 * Path layout:
 *
 *   - `figma/<frame-name>.svg` — raw SVG markup from
 *     `renderFigToSvg`.
 *   - `figma/<frame-name>.html` — the same SVG wrapped in a minimal
 *     HTML document so it can be loaded inside an `<iframe>` from the
 *     preview shell. Wrapping in HTML (rather than pointing the
 *     iframe at the SVG file directly) keeps the `<svg>` viewBox
 *     unscaled and avoids browser-specific differences in how SVG
 *     documents handle `<head>`-less rendering.
 */
import { renderFigToSvg } from "@higma-document-renderers/fig/svg";
import { createCachingFontLoader } from "@higma-document-models/fig/font";
import { createNodeFontLoader } from "@higma-document-renderers/fig/font-drivers/node";
import { figRawResources } from "@higma-document-io/fig/context";
import type { WebFontPlan } from "@higma-document-models/fig/font";
import type { FigSymbolContext } from "@higma-document-io/fig/context";
import type { EmitFile, FrameTarget } from "../types";
import { renderFontLinkNodes } from "../font-links";
import { doctype, el, raw, text } from "../../lib/html-tree/builder";
import { serialize } from "../../lib/html-tree/serialize";
import type { HtmlNode } from "../../lib/html-tree/types";

export type FigmaSvgFiles = {
  readonly svg: EmitFile;
  readonly html: EmitFile;
  /** Slug used by the preview shell to reference these files. */
  readonly slug: string;
};

/**
 * Render one frame to authoritative Figma SVG and wrap it for iframe
 * embedding in the preview shell. `fontPlan` is the same web-font
 * descriptor the host page links — without it the iframe would
 * silently fall back to the browser's default serif and the pixel
 * diff against the React render becomes meaningless on every text
 * layer.
 */
export async function emitFigmaSvgForFrame(
  source: FigSymbolContext,
  target: FrameTarget,
  fontPlan: WebFontPlan,
): Promise<FigmaSvgFiles | undefined> {
  const node = target.node;
  if (!node.size) {
    return undefined;
  }
  // The renderer's text path needs OS-resolved font metrics whenever
  // the .fig itself does not embed them via `derivedTextData`.
  // Hand-authored figs from Figma typically embed metrics; .figs that
  // come from web-to-fig do not. Pass an OS-only loader so the same
  // resolution rules the host browser uses are applied here. The
  // bundle's own `<link>` elements (built from `fontPlan`) load
  // missing web fonts on the client — we deliberately do *not* pull
  // them in via `@fontsource` here; that path silently substitutes
  // the bundle even when the OS already carries the family, which
  // produces metric drift between this authoritative render and the
  // browser's React render.
  const fontLoader = createCachingFontLoader(createNodeFontLoader());
  // SoT: spread the canonical four-field bundle from the IO layer
  // instead of re-listing `symbolMap` / `styleRegistry` / `blobs` /
  // `images` by hand. Re-deriving any of them inline would diverge
  // from the post-style-resolution maps other consumers see.
  //
  // The authoritative SVG render is a *comparison-only* artefact for
  // the dual-pane preview shell. When the source .fig authors a
  // platform-licensed family that the host environment cannot supply
  // (e.g. "SF Pro Rounded" on a non-darwin runner with no installed
  // Apple fonts), the renderer's font preload throws. That failure
  // should not block TSX emission for the same frame — the React
  // output is a separate artefact that only embeds the font *name*
  // and lets the consumer page load it however it wants. Catch the
  // render failure here, log it, and return `undefined` so the
  // orchestrator (which already treats a missing figma pair as
  // "no comparison surface for this frame") simply skips the SVG
  // side for that frame.
  const result = await renderFigToSvg([node], {
    width: node.size.x,
    height: node.size.y,
    ...figRawResources(source),
    normalizeRootTransform: true,
    fontLoader,
    // The authoritative SVG is loaded inside an `<iframe>` running in a
    // normal web browser whose backbuffer is sRGB. Image paints flagged
    // `imageShouldColorManage` therefore convert to SRGB so the iframe
    // shows the same colours the React render produces. Passing this
    // explicitly is required by the renderer's fail-fast colour
    // contract (`requireManagedImageColorProfile` throws if the caller
    // has not made the choice).
    exportSettings: { colorProfile: "SRGB" },
  }).catch((err: unknown): undefined => {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(
      `[higma] figma SVG render for frame "${target.node.name ?? target.componentName}" failed: ${reason}. ` +
      `TSX emission continues; the dual-pane preview will have no Figma source pane for this frame.`,
    );
    return undefined;
  });
  if (!result) {
    return undefined;
  }
  const svgString = String(result.svg);
  const slug = svgSlugFor(target);
  const svgPath = `figma/${slug}.svg`;
  const htmlPath = `figma/${slug}.html`;
  return {
    svg: { path: svgPath, contents: svgString },
    html: { path: htmlPath, contents: htmlDocFor(svgString, fontPlan) },
    slug,
  };
}

function svgSlugFor(target: FrameTarget): string {
  return target.filePath
    .replace(/^pages\//, "")
    .replace(/\.tsx$/, "")
    .replace(/\//g, "__");
}

/**
 * Build the iframe-host HTML around the SVG body. The `svg` argument
 * is treated as already-validated XML (it comes from the SVG renderer
 * package which owns its own escaping); every other value flows
 * through the `html-tree` serializer so user-controlled font names
 * cannot inject markup.
 */
function htmlDocFor(svg: string, fontPlan: WebFontPlan): string {
  const head: HtmlNode[] = [
    el("meta", { charset: "utf-8" }),
    el("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
    ...renderFontLinkNodes(fontPlan),
    el("style", {}, [
      text("html, body { margin: 0; padding: 0; background: #fff; } svg { display: block; }"),
    ]),
  ];
  const document: HtmlNode[] = [
    doctype(),
    el("html", {}, [
      el("head", {}, head),
      el("body", {}, [raw(svg)]),
    ]),
  ];
  return `${serialize(document)}\n`;
}
