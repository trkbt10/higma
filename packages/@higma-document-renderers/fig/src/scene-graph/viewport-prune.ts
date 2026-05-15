/**
 * @file Scene-graph viewport pruning
 *
 * Walks a {@link SceneGraph} and drops every subtree whose world-space
 * bounding box lies entirely outside the graph's viewport. The pruner
 * is a structural optimisation — visually, the root viewport clip the
 * SVG renderer emits already hides off-viewport content; pruning makes
 * that semantic *also* tractable for downstream rasterisers.
 *
 * Concretely, resvg's bbox computation panics (`geom.rs:27 unwrap None`)
 * on masked subtrees translated past the viewport. The App Store
 * template's `App page screenshots` frame is the calibration case: ten
 * iPhone-screenshot tiles laid out at x=0, 248, 496, …, 2484 inside a
 * 402-wide viewport. Without pruning the SVG renderer emits every tile,
 * including the seven whose left edge is past x=402, and resvg crashes
 * on the first `<g transform="…translate(996,0)">` wrapping a `<mask>`.
 *
 * The pruner is a general fig parse / render concern, not specialised
 * to App Store: any Figma file whose root canvas has off-viewport
 * content gets the same SVG bloat (and the same resvg crash for masked
 * content). Pruning at the scene-graph level keeps every downstream
 * pipeline (SVG, WebGL, React) consistent.
 *
 * What it does NOT do:
 *
 * - Compute clip-aware bounding boxes. A `clipsContent=true` frame
 *   bounds its visible children, but we still treat its `subtree bbox`
 *   as the union of all child bboxes. The result is conservative —
 *   children that lie outside the clip but inside the viewport stay,
 *   even though they would be visually clipped. Pruning fewer nodes is
 *   the safe choice.
 *
 * - Account for effect halos (drop-shadow blur, layer blur). A small
 *   safety padding is applied around the viewport so a shadow that
 *   spills slightly outside the viewport is preserved.
 */

import type { AffineMatrix } from "@higma-primitives/path";
import type { SceneGraph, SceneNode } from "@higma-document-models/fig/scene-graph";

type WorldBox = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

const IDENTITY: AffineMatrix = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

/**
 * Safety padding (in world-space units) added around the viewport
 * before testing intersection. A node's nominal bbox may understate
 * the visible footprint — drop-shadow blur, layer blur and per-side
 * stroke weights extend beyond `width`/`height`. The pad protects the
 * common cases without re-deriving every effect-halo computation here.
 *
 * `64` covers a typical iOS shadow stack (~16 px) with comfortable
 * headroom; smaller numbers risk dropping content with mid-sized
 * halos. The App Store template's off-viewport content sits 600 px+
 * outside the viewport so the choice of pad doesn't matter for that
 * calibration case; the pad is for documents authored elsewhere with
 * tighter margins.
 */
const VIEWPORT_SAFETY_PAD = 64;

/**
 * Compose two 2x3 affine matrices as `parent * child` so the result
 * maps a child-local point to the parent's coordinate system. This
 * mirrors `transformPathCommands` from `@higma-primitives/path` but
 * for the matrix layer rather than path commands.
 */
function composeAffine(parent: AffineMatrix, child: AffineMatrix): AffineMatrix {
  return {
    m00: parent.m00 * child.m00 + parent.m01 * child.m10,
    m01: parent.m00 * child.m01 + parent.m01 * child.m11,
    m02: parent.m00 * child.m02 + parent.m01 * child.m12 + parent.m02,
    m10: parent.m10 * child.m00 + parent.m11 * child.m10,
    m11: parent.m10 * child.m01 + parent.m11 * child.m11,
    m12: parent.m10 * child.m02 + parent.m11 * child.m12 + parent.m12,
  };
}

/**
 * Transform a 4-corner box by an affine matrix and return the axis-
 * aligned bounding box of the resulting quadrilateral. Correct for
 * any 2D affine (translate, scale, rotate, shear).
 */
function transformBox(box: WorldBox, m: AffineMatrix): WorldBox {
  const corners: { readonly x: number; readonly y: number }[] = [
    { x: m.m00 * box.x + m.m01 * box.y + m.m02, y: m.m10 * box.x + m.m11 * box.y + m.m12 },
    { x: m.m00 * (box.x + box.w) + m.m01 * box.y + m.m02, y: m.m10 * (box.x + box.w) + m.m11 * box.y + m.m12 },
    { x: m.m00 * box.x + m.m01 * (box.y + box.h) + m.m02, y: m.m10 * box.x + m.m11 * (box.y + box.h) + m.m12 },
    { x: m.m00 * (box.x + box.w) + m.m01 * (box.y + box.h) + m.m02, y: m.m10 * (box.x + box.w) + m.m11 * (box.y + box.h) + m.m12 },
  ];
  let xMin = corners[0].x, xMax = corners[0].x, yMin = corners[0].y, yMax = corners[0].y;
  for (let i = 1; i < corners.length; i++) {
    const c = corners[i];
    if (c.x < xMin) { xMin = c.x; }
    if (c.x > xMax) { xMax = c.x; }
    if (c.y < yMin) { yMin = c.y; }
    if (c.y > yMax) { yMax = c.y; }
  }
  return { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin };
}

function unionBox(a: WorldBox, b: WorldBox): WorldBox {
  const xMin = Math.min(a.x, b.x);
  const yMin = Math.min(a.y, b.y);
  const xMax = Math.max(a.x + a.w, b.x + b.w);
  const yMax = Math.max(a.y + a.h, b.y + b.h);
  return { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin };
}

function boxesIntersect(a: WorldBox, b: WorldBox): boolean {
  if (a.x + a.w < b.x) { return false; }
  if (b.x + b.w < a.x) { return false; }
  if (a.y + a.h < b.y) { return false; }
  if (b.y + b.h < a.y) { return false; }
  return true;
}

/**
 * Intrinsic local-space bbox for a single node, NOT counting children.
 * `undefined` for node types whose local extent depends on descendants
 * (groups) or on parsing contours we'd rather not redo here (paths).
 */
function localBox(node: SceneNode): WorldBox | undefined {
  switch (node.type) {
    case "frame":
    case "rect":
    case "image":
    case "text":
      return { x: 0, y: 0, w: node.width, h: node.height };
    case "ellipse":
      return { x: node.cx - node.rx, y: node.cy - node.ry, w: node.rx * 2, h: node.ry * 2 };
    case "path":
    case "group":
      return undefined;
  }
}

function nodeChildren(node: SceneNode): readonly SceneNode[] | undefined {
  if (node.type === "frame" || node.type === "group") {
    return node.children;
  }
  return undefined;
}

/**
 * Compute the world-space bbox of a subtree rooted at `node`, given
 * the parent's accumulated world transform. Returns `undefined` when
 * the subtree has no measurable footprint (e.g. an empty group).
 */
function subtreeWorldBox(node: SceneNode, parentWorld: AffineMatrix): WorldBox | undefined {
  if (node.visible === false) { return undefined; }
  const worldM = composeAffine(parentWorld, node.transform);
  let bbox: WorldBox | undefined;
  const own = localBox(node);
  if (own) { bbox = transformBox(own, worldM); }
  const children = nodeChildren(node);
  if (children) {
    for (const child of children) {
      const childBox = subtreeWorldBox(child, worldM);
      if (!childBox) { continue; }
      bbox = bbox ? unionBox(bbox, childBox) : childBox;
    }
  }
  return bbox;
}

function pruneNode(node: SceneNode, parentWorld: AffineMatrix, paddedViewport: WorldBox): SceneNode | null {
  const worldM = composeAffine(parentWorld, node.transform);
  const subtree = subtreeWorldBox(node, parentWorld);
  if (subtree && !boxesIntersect(subtree, paddedViewport)) {
    return null;
  }
  // Only `frame` and `group` nodes carry a `children` array. Other
  // SceneNode variants (rect, ellipse, path, text, image) have no
  // descendants to recurse into and can be returned as-is.
  if (node.type !== "frame" && node.type !== "group") {
    return node;
  }
  const children = node.children;
  let mutated = false;
  const next: SceneNode[] = [];
  for (const child of children) {
    const pruned = pruneNode(child, worldM, paddedViewport);
    if (pruned !== child) { mutated = true; }
    if (pruned !== null) { next.push(pruned); }
  }
  if (!mutated) { return node; }
  if (node.type === "frame") {
    return { ...node, children: next };
  }
  return { ...node, children: next };
}

/**
 * Drop subtrees whose world-space bbox is entirely outside the
 * scene-graph viewport. Returns the input by reference when nothing
 * was pruned so downstream identity checks stay stable.
 *
 * The pruner is conservative — it never drops a subtree whose bbox
 * intersects the (safety-padded) viewport, and it never drops a node
 * whose intrinsic bbox can't be measured (paths, empty groups).
 */
export function pruneSceneGraphToViewport(sceneGraph: SceneGraph): SceneGraph {
  if (!sceneGraph.viewport) { return sceneGraph; }
  const paddedViewport: WorldBox = {
    x: sceneGraph.viewport.x - VIEWPORT_SAFETY_PAD,
    y: sceneGraph.viewport.y - VIEWPORT_SAFETY_PAD,
    w: sceneGraph.viewport.width + VIEWPORT_SAFETY_PAD * 2,
    h: sceneGraph.viewport.height + VIEWPORT_SAFETY_PAD * 2,
  };
  let mutated = false;
  const nextRootChildren: SceneNode[] = [];
  for (const child of sceneGraph.root.children) {
    const pruned = pruneNode(child, IDENTITY, paddedViewport);
    if (pruned !== child) { mutated = true; }
    if (pruned !== null) { nextRootChildren.push(pruned); }
  }
  if (!mutated) { return sceneGraph; }
  return {
    ...sceneGraph,
    root: { ...sceneGraph.root, children: nextRootChildren },
  };
}
