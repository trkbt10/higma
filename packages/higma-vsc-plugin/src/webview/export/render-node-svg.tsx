/**
 * @file Build a standalone SVG string for a single fig node by
 * re-rendering it off-screen with `FigFamilyPageRenderer` and
 * serialising the resulting `<svg>`.
 *
 * The off-screen approach reuses the production renderer rather than
 * shipping a parallel SVG generator. The cost is one extra
 * `createRoot` per export and a transient hidden DOM node, both
 * cleaned up before the function resolves.
 *
 * Rotation handling: the node's own `transform` is preserved so the
 * exported asset matches what the canvas paints. We compute the
 * rotated AABB of the node's local rectangle, translate so the AABB
 * sits at (0, 0), and feed that translated transform into a
 * synthetic single-child page. The renderer's viewport is sized to
 * the AABB, producing an SVG that exactly contains the node.
 *
 * Async caveat: `FigFamilyPageRenderer` may load fonts or images
 * after first commit. We poll for two animation frames, which covers
 * everything in cache (the canvas just rendered the same node) but
 * may race with first-time decoding for nodes never seen on screen.
 * That is acceptable for the inspect-panel export flow because the
 * user has just seen the node selected on the canvas.
 */

import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  FigFamilyPageRendererFromResources,
  createFigFamilyRenderOptions,
} from "@higma-figma-runtime/react-renderer";
import { figDocumentResources } from "@higma-document-io/fig/context";
import { createCanvasMetricsTextFontResolver } from "@higma-document-renderers/fig/font-drivers/browser";
import type {
  FigDesignDocument,
  FigDesignNode,
  FigPage,
} from "@higma-document-models/fig/domain";
import type { FigMatrix } from "@higma-document-models/fig/types";

export type RenderedNodeSvg = {
  /** Serialised standalone `<svg>` document. */
  readonly svgString: string;
  /** Logical width in canvas pixels (pre-scale). */
  readonly width: number;
  /** Logical height in canvas pixels (pre-scale). */
  readonly height: number;
};

export type RenderNodeSvgArgs = {
  readonly document: FigDesignDocument;
  readonly page: FigPage;
  readonly node: FigDesignNode;
  readonly renderOptions: ReturnType<typeof createFigFamilyRenderOptions>;
  readonly textFontResolver: ReturnType<typeof createCanvasMetricsTextFontResolver>;
};






export async function renderNodeToSvg(args: RenderNodeSvgArgs): Promise<RenderedNodeSvg> {
  const { node, page } = args;
  const localAabb = aabbOfTransformedRect(node.transform, node.size.x, node.size.y);
  const width = Math.max(1, localAabb.width);
  const height = Math.max(1, localAabb.height);

  const adjustedTransform: FigMatrix = {
    ...node.transform,
    m02: node.transform.m02 - localAabb.x,
    m12: node.transform.m12 - localAabb.y,
  };

  const syntheticPage: FigPage = {
    ...page,
    children: [{ ...node, transform: adjustedTransform } satisfies FigDesignNode],
  };

  const host = window.document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-100000px";
  host.style.top = "0";
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  host.style.pointerEvents = "none";
  host.style.opacity = "0";
  window.document.body.appendChild(host);

  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(
        <FigFamilyPageRendererFromResources
          page={syntheticPage}
          canvasWidth={width}
          canvasHeight={height}
          viewportX={0}
          viewportY={0}
          viewportWidth={width}
          viewportHeight={height}
          resources={figDocumentResources(args.document)}
          renderOptions={args.renderOptions}
          textFontResolver={args.textFontResolver}
        />,
      );
    });
    await waitTwoFrames();
    const svg = host.querySelector<SVGSVGElement>("svg[data-fig-family-page-renderer]");
    if (!svg) {
      throw new Error("renderer did not produce an SVG element");
    }
    const svgString = serializeStandaloneSvg(svg);
    return { svgString, width, height };
  } finally {
    root.unmount();
    host.remove();
  }
}

function waitTwoFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function serializeStandaloneSvg(svg: SVGSVGElement): string {
  // Clone so the in-DOM node is not mutated.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!clone.getAttribute("xmlns:xlink")) {
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }
  const serializer = new XMLSerializer();
  return serializer.serializeToString(clone);
}

function aabbOfTransformedRect(m: FigMatrix, w: number, h: number): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  const corners = [
    apply(m, 0, 0),
    apply(m, w, 0),
    apply(m, w, h),
    apply(m, 0, h),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function apply(m: FigMatrix, x: number, y: number): { readonly x: number; readonly y: number } {
  return {
    x: m.m00 * x + m.m01 * y + m.m02,
    y: m.m10 * x + m.m11 * y + m.m12,
  };
}
