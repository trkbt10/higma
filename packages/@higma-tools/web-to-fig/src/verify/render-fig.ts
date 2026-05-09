/**
 * @file Render a `.fig` byte buffer to SVG / PNG using the existing
 * `@higma-document-renderers/fig` pipeline.
 *
 * The contract: `.fig` bytes in, SVG string + PNG bytes out, one per
 * top-level FRAME under the canvas. Designed for the visual-fidelity
 * verifier — every render goes through the renderer the rest of
 * Higma uses, so a passing comparison proves both writer and reader
 * agree with the project's authoritative scene-graph code.
 *
 * Why this lives in the web-to-fig package: the verifier is an
 * inversion sanity check and depends on web-to-fig's own emit. It
 * cannot live in fig-to-web because that's a same-scope sibling.
 */
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import { buildNodeTree } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import { renderFigToSvg } from "@higma-document-renderers/fig/svg";
import { createCachingFontLoader } from "@higma-document-renderers/fig/font";
import { createNodeFontLoader } from "@higma-document-renderers/fig/font-drivers/node";
import { Resvg } from "@resvg/resvg-js";

export type RenderedFrame = {
  /** The frame's name as authored in the .fig (e.g. `mobile / 375×667`). */
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly svg: string;
  readonly png: Uint8Array;
};

export type RenderFigOptions = {
  /** Optional DPR applied to the PNG raster. Defaults to 1. */
  readonly devicePixelRatio?: number;
};

/**
 * Walk every top-level FRAME under the first canvas and render each
 * one to SVG + PNG. Frames named `Internal Only Canvas` etc. are
 * skipped — only nodes whose parent is the first CANVAS node are
 * considered renderable surfaces.
 */
export async function renderFigBytes(
  bytes: Uint8Array,
  options: RenderFigOptions = {},
): Promise<readonly RenderedFrame[]> {
  const loaded = await loadFigFile(bytes);
  const tree = buildNodeTree(loaded.nodeChanges);
  // OS font resolution via the renderer's own loader. With TTC
  // support and per-file fault tolerance now in place, the stock
  // entry handles macOS / Linux / Windows system font directories
  // directly — no verifier-side fallback required.
  const fontLoader = createCachingFontLoader(createNodeFontLoader());
  const dpr = options.devicePixelRatio ?? 1;

  const canvas = pickFirstVisibleCanvas(tree.roots);
  if (!canvas) {
    throw new Error("renderFigBytes: no visible CANVAS node found in the .fig");
  }
  const targets = (canvas.children ?? []).filter(
    (child): child is FigNode =>
      child !== null
      && child !== undefined
      && (child.type.name === "FRAME" || child.type.name === "COMPONENT"),
  );
  if (targets.length === 0) {
    throw new Error("renderFigBytes: canvas has no FRAME children to render");
  }
  const out: RenderedFrame[] = [];
  for (const node of targets) {
    if (!node.size) {
      throw new Error(`renderFigBytes: frame "${node.name}" has no size`);
    }
    const svg = await renderFrameToSvg(node, loaded, tree.nodeMap, fontLoader);
    const png = svgToPng(svg, node.size.x, node.size.y, dpr);
    out.push({ name: node.name ?? "(unnamed)", width: node.size.x, height: node.size.y, svg, png });
  }
  return out;
}

async function renderFrameToSvg(
  node: FigNode,
  loaded: Awaited<ReturnType<typeof loadFigFile>>,
  symbolMap: ReadonlyMap<string, FigNode>,
  fontLoader: ReturnType<typeof createCachingFontLoader>,
): Promise<string> {
  if (!node.size) {
    throw new Error("renderFrameToSvg: node has no size");
  }
  const result = await renderFigToSvg([node], {
    width: node.size.x,
    height: node.size.y,
    blobs: loaded.blobs ?? [],
    images: loaded.images ?? new Map(),
    normalizeRootTransform: true,
    symbolMap,
    fontLoader,
  });
  return String(result.svg);
}

function pickFirstVisibleCanvas(roots: readonly FigNode[]): FigNode | undefined {
  for (const root of roots) {
    const found = findCanvasInTree(root);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function findCanvasInTree(node: FigNode): FigNode | undefined {
  if (node.type.name === "CANVAS" && node.visible !== false && node.internalOnly !== true) {
    return node;
  }
  for (const child of node.children ?? []) {
    if (!child) {
      continue;
    }
    const found = findCanvasInTree(child);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function svgToPng(svg: string, width: number, height: number, dpr: number): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: Math.round(width * dpr) },
    background: "transparent",
    font: { loadSystemFonts: true },
  });
  const rendered = resvg.render();
  const buf = rendered.asPng();
  // Resvg adjusts height proportionally; verify that matches expectation.
  void height;
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
