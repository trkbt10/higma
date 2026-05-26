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
 * Rotation handling: the node's own `transform` is preserved. We
 * compute the node's world-space AABB and make that rectangle the
 * renderer viewport, so export consumes the original Kiwi node rather
 * than a translated clone.
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
  FigFamilyPageRenderer,
  createFigFamilyRenderOptions,
} from "@higma-figma-runtime/react-renderer";
import { createKiwiSceneGraphPipeline, type KiwiSceneGraphMutation } from "@higma-document-renderers/fig/scene-graph";
import { figDocumentResources, type FigDocumentContext } from "@higma-document-io/fig";
import { guidToString } from "@higma-document-models/fig/domain";
import { readKiwiTransform } from "@higma-document-models/fig/matrix";
import type { FigMatrix, FigNode, FigVector } from "@higma-document-models/fig/types";

export type RenderedNodeSvg = {
  /** Serialised standalone `<svg>` document. */
  readonly svgString: string;
  /** Logical width in canvas pixels (pre-scale). */
  readonly width: number;
  /** Logical height in canvas pixels (pre-scale). */
  readonly height: number;
};

export type RenderNodeSvgArgs = {
  readonly context: FigDocumentContext;
  readonly page: FigNode;
  readonly node: FigNode;
  readonly renderOptions: ReturnType<typeof createFigFamilyRenderOptions>;
};

const INITIAL_VSC_EXPORT_KIWI_DOCUMENT_MUTATION: KiwiSceneGraphMutation = Object.freeze({
  revision: 0,
  scope: "initial-load",
  changedGuidKeys: [],
});






/** Render one Kiwi node through the shared fig renderer and return a standalone SVG. */
export async function renderNodeToSvg(args: RenderNodeSvgArgs): Promise<RenderedNodeSvg> {
  const { node, page } = args;
  const transform = readKiwiTransform(node.transform);
  const size = requireSize(node);
  const localAabb = aabbOfTransformedRect(transform, size.x, size.y);
  const width = Math.max(1, localAabb.width);
  const height = Math.max(1, localAabb.height);
  const sceneGraph = createKiwiSceneGraphPipeline().resolve({
    page,
    nodes: [node],
    canvasWidth: width,
    canvasHeight: height,
    viewportX: localAabb.x,
    viewportY: localAabb.y,
    viewportWidth: width,
    viewportHeight: height,
    kiwiDocumentMutation: INITIAL_VSC_EXPORT_KIWI_DOCUMENT_MUTATION,
    pruneToViewport: true,
    resources: figDocumentResources(args.context),
  });
  if (sceneGraph === null) {
    throw new Error(`VSC fig SVG export could not build SceneGraph for Kiwi node ${guidToString(node.guid)}`);
  }

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
        <FigFamilyPageRenderer
          sceneGraph={sceneGraph}
          renderOptions={args.renderOptions}
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

function requireSize(node: FigNode): FigVector {
  if (node.size === undefined) {
    throw new Error(`VSC fig SVG export requires size for Kiwi node ${guidToString(node.guid)}`);
  }
  return node.size;
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
