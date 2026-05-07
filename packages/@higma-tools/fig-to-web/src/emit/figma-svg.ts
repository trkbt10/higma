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
import type { FigSource } from "../fig-source";
import type { EmitFile, FrameTarget } from "./types";

export type FigmaSvgFiles = {
  readonly svg: EmitFile;
  readonly html: EmitFile;
  /** Slug used by the preview shell to reference these files. */
  readonly slug: string;
};

/**
 * Render one frame to authoritative Figma SVG and wrap it for iframe
 * embedding in the preview shell. `fontFamilies` is the same set of
 * Google Fonts families the host page links — without it the iframe
 * would silently fall back to the browser's default serif and the
 * pixel diff against the React render becomes meaningless on every
 * text layer.
 */
export async function emitFigmaSvgForFrame(
  source: FigSource,
  target: FrameTarget,
  fontFamilies: readonly string[],
): Promise<FigmaSvgFiles | undefined> {
  const node = target.node;
  if (!node.size) {
    return undefined;
  }
  const result = await renderFigToSvg([node], {
    width: node.size.x,
    height: node.size.y,
    blobs: source.loaded.blobs ?? [],
    images: source.loaded.images ?? new Map(),
    normalizeRootTransform: true,
    symbolMap: source.tree.nodeMap,
  });
  const svgString = String(result.svg);
  const slug = svgSlugFor(target);
  const svgPath = `figma/${slug}.svg`;
  const htmlPath = `figma/${slug}.html`;
  return {
    svg: { path: svgPath, contents: svgString },
    html: { path: htmlPath, contents: htmlDocFor(svgString, fontFamilies) },
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
 * Wrap the SVG in a minimal HTML document. The viewport meta keeps
 * mobile browsers from auto-scaling, and the `margin: 0` reset stops
 * iframes from inheriting the host document's body padding. Google
 * Font links match the host index.html so `<text font-family="...">`
 * resolves to the same web font in both panes.
 */
function htmlDocFor(svg: string, fontFamilies: readonly string[]): string {
  const fontLinks = renderFontLinks(fontFamilies);
  return [
    `<!doctype html>`,
    `<html>`,
    `<head>`,
    `  <meta charset="utf-8" />`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1" />`,
    ...fontLinks,
    `  <style>`,
    `    html, body { margin: 0; padding: 0; background: #fff; }`,
    `    svg { display: block; }`,
    `  </style>`,
    `</head>`,
    `<body>`,
    svg,
    `</body>`,
    `</html>`,
    ``,
  ].join("\n");
}

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
