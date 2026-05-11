/**
 * @file Multi-row / multi-column clustering pass.
 *
 * Why: a Figma frame whose children are arranged in a 2-D grid (header
 * row above a hero card above a product row, for example) does not
 * fit the single-axis stack `inferLayout` understands. Children may
 * be on the same canvas axis but at different counter-axis bands.
 * `inferLayout` declines and the frame falls back to `position:
 * relative` with every child `position: absolute` — a literal
 * reproduction that drops every web-idiomatic flex/padding affordance.
 *
 * This pass synthesises *row-group* (or column-group) FRAME nodes
 * around clean axis-bands so that, post-clustering:
 *
 *   - the parent frame's children become a clean single-axis stack
 *     of synthetic row-groups, which `inferLayout` can then translate
 *     to `display: flex; flex-direction: column`;
 *   - each synthetic row-group's children sit in a single Y-band by
 *     construction, so the same `inferLayout` invocation on the row
 *     group produces a `flex-direction: row` (when the inner X-gaps
 *     are uniform) or a positioned wrapper (when they aren't —
 *     keeping the visual without claiming to be flex);
 *   - children that span multiple bands (decorative scribbles, hero
 *     overlays) are tagged `stackPositioning: ABSOLUTE` so the
 *     stack inference ignores them while the JSX emitter still
 *     renders them as positioned overlays inside the synthesised
 *     container.
 *
 * The pass is *additive* on top of `reparent.ts`'s overlay: this
 * function reuses the same `ReparentResult` shape (`childrenByParent`
 * / `transformByGuid` maps) so a single overlay covers both spatial
 * reparenting and row clustering. The emitter consumes both via
 * `safeChildren(node, context)`.
 *
 * Failure behaviour is "do nothing": when a frame's children do not
 * cluster cleanly, the original children list is left untouched and
 * the existing absolute-positioning behaviour applies. We never
 * fabricate layout that wasn't there.
 *
 * Constraints (deliberately narrow to avoid mis-grouping):
 *
 *   1. Only frames without explicit `stackMode` are candidates —
 *      Figma already authored those.
 *   2. The frame must have its `size` set (we synthesise relative
 *      transforms against the frame's box) and at least 3 visible
 *      children with bounds.
 *   3. We pick the clustering axis that produces the most clusters,
 *      then require ≥ 2 clusters separated by ≥ MIN_BAND_GAP px.
 *   4. A child that overlaps two or more clusters on the chosen axis
 *      is tagged ABSOLUTE — it is decoration, not flow.
 *   5. We refuse to cluster when ≥ 60 % of children would land in
 *      one band; that case is "this frame is already a single-row
 *      stack", and the existing inference gives a better answer.
 */
import type { FigGuid, FigMatrix, FigNode } from "@higma-document-models/fig/types";
import { guidToString, safeChildren as safeChildrenDomain } from "@higma-document-models/fig/domain";

/** Bands closer than this px count as a single band — see MIN_BAND_GAP comments. */
const MIN_BAND_GAP = 1.5;
/** Drop clustering when one band swallows this fraction of children. */
const DOMINANT_BAND_THRESHOLD = 0.6;
/** Need at least this many flow children before clustering is worth attempting. */
const MIN_CHILDREN_FOR_CLUSTERING = 3;

type Box = {
  readonly node: FigNode;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

type Cluster = {
  readonly start: number;
  readonly end: number;
  readonly boxes: readonly Box[];
};

/** Mutable working struct used while greedily merging. */
type ClusterBuilder = {
  start: number;
  end: number;
  readonly boxes: Box[];
};

function boxOf(node: FigNode, index: number): Box | undefined {
  // Clustering needs both a size and a transform. Refuse the node
  // when either is absent — silently treating a missing transform as
  // origin would place the node at (0,0) of its parent and cluster it
  // alongside the actually-positioned siblings, fabricating a layout
  // the source does not authorise. Document / Canvas / orphan nodes
  // legitimately lack a transform and the caller correctly skips them
  // by virtue of `boxOf` returning `undefined`.
  if (!node.size) {
    return undefined;
  }
  const t = node.transform;
  if (!t) {
    return undefined;
  }
  const w = node.size.x;
  const h = node.size.y;
  if (!Number.isFinite(t.m02) || !Number.isFinite(t.m12) || w <= 0 || h <= 0) {
    return undefined;
  }
  return { node, index, x: t.m02, y: t.m12, w, h };
}

function isVisible(node: FigNode): boolean {
  return node.visible !== false;
}

function hasExplicitAutoLayout(node: FigNode): boolean {
  const m = node.stackMode?.name;
  return m === "VERTICAL" || m === "HORIZONTAL";
}

type Axis = "y" | "x";

function rangeOf(box: Box, axis: Axis): { readonly start: number; readonly end: number } {
  if (axis === "y") {
    return { start: box.y, end: box.y + box.h };
  }
  return { start: box.x, end: box.x + box.w };
}

/**
 * Greedy bottom-up clustering along an axis. Boxes are sorted by their
 * range start; a new cluster starts whenever the current box's start
 * exceeds the running cluster's end by more than `MIN_BAND_GAP`.
 *
 * The result is the maximal set of bands such that every box is fully
 * inside one band and bands are separated. Boxes that overlap two
 * adjacent bands stretch the earlier band — they end up assigned to
 * the band that started first; cross-band detection happens in a
 * second pass below.
 */
function clusterByAxis(boxes: readonly Box[], axis: Axis): readonly Cluster[] {
  if (boxes.length === 0) {
    return [];
  }
  const sorted = [...boxes].sort((a, b) => rangeOf(a, axis).start - rangeOf(b, axis).start);
  const builders: ClusterBuilder[] = [];
  for (const box of sorted) {
    const range = rangeOf(box, axis);
    const last = builders[builders.length - 1];
    if (!last || range.start > last.end + MIN_BAND_GAP) {
      builders.push({ start: range.start, end: range.end, boxes: [box] });
      continue;
    }
    last.boxes.push(box);
    if (range.end > last.end) {
      last.end = range.end;
    }
  }
  return builders.map((b) => ({ start: b.start, end: b.end, boxes: b.boxes }));
}

/**
 * Identify children whose axis-range strictly straddles a clean
 * boundary between two adjacent bands — those children are
 * decorative overlays. Returns the set of indices that should be
 * tagged `stackPositioning: ABSOLUTE` and removed from the flow.
 *
 * "Straddles" means the child's range starts inside one cluster (or
 * the gap before it) and ends inside another cluster (or the gap
 * after it). We do this on a clean re-clustering: the candidate
 * outliers are excluded, the remaining boxes re-cluster into stable
 * non-overlapping bands, and any candidate whose range crosses one
 * of those band gaps is confirmed as an outlier.
 */
function countBandsTouched(box: Box, clusters: readonly Cluster[], axis: Axis): number {
  const range = rangeOf(box, axis);
  return clusters.reduce((count, cluster) => {
    if (range.start < cluster.end && range.end > cluster.start) {
      return count + 1;
    }
    return count;
  }, 0);
}

function detectOutliers(boxes: readonly Box[], axis: Axis): {
  readonly flow: readonly Box[];
  readonly outliers: readonly Box[];
  readonly clusters: readonly Cluster[];
} {
  // Score each box by how many bands it crosses in a coarse first pass.
  const initial = clusterByAxis(boxes, axis);
  if (initial.length < 2) {
    return { flow: boxes, outliers: [], clusters: initial };
  }
  const outlierIdx = new Set<number>();
  for (const box of boxes) {
    if (countBandsTouched(box, initial, axis) >= 2) {
      outlierIdx.add(box.index);
    }
  }
  if (outlierIdx.size === 0) {
    return { flow: boxes, outliers: [], clusters: initial };
  }
  const flow = boxes.filter((b) => !outlierIdx.has(b.index));
  const outliers = boxes.filter((b) => outlierIdx.has(b.index));
  const refined = clusterByAxis(flow, axis);
  return { flow, outliers, clusters: refined };
}

function dominantBandFraction(clusters: readonly Cluster[]): number {
  if (clusters.length === 0) {
    return 0;
  }
  const total = clusters.reduce((sum, c) => sum + c.boxes.length, 0);
  if (total === 0) {
    return 0;
  }
  const max = clusters.reduce((m, c) => Math.max(m, c.boxes.length), 0);
  return max / total;
}

type ClusteringChoice = {
  readonly axis: Axis;
  readonly clusters: readonly Cluster[];
  readonly outliers: readonly Box[];
};

function pickAxis(boxes: readonly Box[]): ClusteringChoice | undefined {
  const yChoice = detectOutliers(boxes, "y");
  const xChoice = detectOutliers(boxes, "x");
  const yViable = yChoice.clusters.length >= 2 && dominantBandFraction(yChoice.clusters) < DOMINANT_BAND_THRESHOLD;
  const xViable = xChoice.clusters.length >= 2 && dominantBandFraction(xChoice.clusters) < DOMINANT_BAND_THRESHOLD;
  if (!yViable && !xViable) {
    return undefined;
  }
  if (yViable && (!xViable || yChoice.clusters.length >= xChoice.clusters.length)) {
    return { axis: "y", clusters: yChoice.clusters, outliers: yChoice.outliers };
  }
  return { axis: "x", clusters: xChoice.clusters, outliers: xChoice.outliers };
}

// =============================================================================
// Synthesis
// =============================================================================

type GuidGenerator = () => FigGuid;

function makeSyntheticGuidGenerator(): GuidGenerator {
  // Use sessionID = -1 (unused by Figma) so synthesised guids never
  // collide with real `nodesByGuid` entries even if we accidentally
  // looked one up by string form.
  const stateRef = { value: 0 };
  return () => {
    stateRef.value += 1;
    return { sessionID: -1, localID: stateRef.value };
  };
}

function reparentTransform(node: FigNode, originX: number, originY: number): FigMatrix {
  // Callers (`synthesiseGroup` over `cluster.boxes`) only reach this
  // function for nodes that already passed `boxOf`'s transform check,
  // so a missing transform here means the cluster pipeline produced
  // an inconsistent state. Throw rather than synthesising an identity
  // matrix — masking the inconsistency would shift the node to (0,0)
  // and render the row group at the wrong place.
  const t = node.transform;
  if (!t) {
    throw new Error(
      `cluster: reparentTransform called on a node without a transform — boxOf should have filtered "${node.name ?? "(unnamed)"}" out`,
    );
  }
  return {
    m00: t.m00,
    m01: t.m01,
    m10: t.m10,
    m11: t.m11,
    m02: t.m02 - originX,
    m12: t.m12 - originY,
  };
}

function bandBounds(cluster: Cluster, axis: Axis): { x: number; y: number; w: number; h: number } {
  const xs = cluster.boxes.map((b) => b.x);
  const ys = cluster.boxes.map((b) => b.y);
  const xe = cluster.boxes.map((b) => b.x + b.w);
  const ye = cluster.boxes.map((b) => b.y + b.h);
  if (axis === "y") {
    const minX = Math.min(...xs);
    const maxX = Math.max(...xe);
    return { x: minX, y: cluster.start, w: maxX - minX, h: cluster.end - cluster.start };
  }
  const minY = Math.min(...ys);
  const maxY = Math.max(...ye);
  return { x: cluster.start, y: minY, w: cluster.end - cluster.start, h: maxY - minY };
}

/**
 * Synthesise a single row/column-group FRAME wrapping `cluster`'s
 * boxes. Children's transforms are rewritten relative to the band's
 * origin so the JSX emitter doesn't need to know about clustering.
 *
 * The synthesised wrapper has:
 *   - a `name` that surfaces in `data-fig-name` for debugging,
 *   - the band's bounding box as `size` and `transform`,
 *   - the same `type` as a regular FRAME so style code-paths apply,
 *   - `children` set to the cluster's nodes (in source paint order
 *     within the cluster, not just axis-sorted, so paint semantics
 *     are preserved).
 */
function synthesiseGroup(
  template: FigNode,
  cluster: Cluster,
  axis: Axis,
  newGuid: GuidGenerator,
  transformByGuid: Map<string, FigMatrix>,
): FigNode {
  const bounds = bandBounds(cluster, axis);
  // Sort children inside the band by source-order index to keep the
  // emitter's z-order stable.
  const sorted = [...cluster.boxes].sort((a, b) => a.index - b.index);
  const children = sorted.map((box) => {
    const newTransform = reparentTransform(box.node, bounds.x, bounds.y);
    transformByGuid.set(guidToString(box.node.guid), newTransform);
    return Object.assign({}, box.node, { transform: newTransform });
  });
  const frameTransform: FigMatrix = {
    m00: 1,
    m01: 0,
    m10: 0,
    m11: 1,
    m02: bounds.x,
    m12: bounds.y,
  };
  // Clone the parent's `phase` and `type` (both `KiwiEnumValue`) so the
  // synthesised wrapper satisfies `FigNode` without inventing enum
  // values. Visual fields are explicitly cleared — the wrapper renders
  // nothing of its own; it is a pure layout box.
  return Object.assign({}, template, {
    guid: newGuid(),
    name: axis === "y" ? "_row_group_" : "_col_group_",
    parentIndex: undefined,
    size: { x: bounds.w, y: bounds.h },
    transform: frameTransform,
    children,
    fillPaints: undefined,
    strokePaints: undefined,
    backgroundPaints: undefined,
    effects: undefined,
    cornerRadius: undefined,
    rectangleCornerRadii: undefined,
    strokeWeight: undefined,
    strokeAlign: undefined,
    strokeJoin: undefined,
    strokeCap: undefined,
    componentPropDefs: undefined,
    componentPropAssignments: undefined,
    overrides: undefined,
    symbolID: undefined,
    symbolData: undefined,
    styleIdForFill: undefined,
    styleIdForStrokeFill: undefined,
    stackMode: undefined,
    stackSpacing: undefined,
    stackPrimaryAlignItems: undefined,
    stackCounterAlignItems: undefined,
    stackPadding: undefined,
    stackHorizontalPadding: undefined,
    stackVerticalPadding: undefined,
    stackPaddingRight: undefined,
    stackPaddingBottom: undefined,
    stackPositioning: undefined,
    clipsContent: false,
  });
}

function markAbsolute(box: Box): FigNode {
  // Surface the existing Figma-native ABSOLUTE marker so
  // `inferLayout`'s flow filter and the emitter's positioning code
  // recognise it without any new field.
  return Object.assign({}, box.node, { stackPositioning: { name: "ABSOLUTE" as const } });
}

function rebuildParentChildren(
  template: FigNode,
  flow: readonly Box[],
  outliers: readonly Box[],
  axis: Axis,
  newGuid: GuidGenerator,
  transformByGuid: Map<string, FigMatrix>,
): readonly FigNode[] {
  const finalClusters = clusterByAxis(flow, axis);
  // No clustering benefit if flow degenerates to one cluster.
  if (finalClusters.length < 2) {
    return [];
  }
  const groups = finalClusters.map((cluster) => synthesiseGroup(template, cluster, axis, newGuid, transformByGuid));
  const overlays = outliers.map(markAbsolute);
  return [...groups, ...overlays];
}

// =============================================================================
// Tree walk
// =============================================================================

/**
 * Walk every frame in the tree (consulting reparent overlays so we
 * see the post-flat-tree-repair structure) and try to cluster its
 * children. Mutate the supplied overlay maps in place.
 */
export function applyRowClustering(
  root: FigNode,
  childrenByParent: Map<string, readonly FigNode[]>,
  transformByGuid: Map<string, FigMatrix>,
): void {
  const newGuid = makeSyntheticGuidGenerator();
  walk(root, childrenByParent, transformByGuid, newGuid);
}

function effectiveChildren(
  parent: FigNode,
  childrenByParent: ReadonlyMap<string, readonly FigNode[]>,
): readonly FigNode[] {
  const overlay = childrenByParent.get(guidToString(parent.guid));
  if (overlay) {
    return overlay;
  }
  return safeChildrenDomain(parent);
}

function shouldClusterParent(parent: FigNode): boolean {
  // Cluster only FRAMEs without explicit auto-layout. SYMBOLs encode
  // component definitions and own their internal layout; the on-disk
  // schema has no COMPONENT_SET NodeType (it is a FRAME with variant
  // metadata, already covered by the FRAME check). See
  // `docs/refactor/component-type-cleanup.md`.
  if (parent.type?.name !== "FRAME") {
    return false;
  }
  if (hasExplicitAutoLayout(parent)) {
    return false;
  }
  if (!parent.size) {
    return false;
  }
  return true;
}

function walk(
  node: FigNode,
  childrenByParent: Map<string, readonly FigNode[]>,
  transformByGuid: Map<string, FigMatrix>,
  newGuid: GuidGenerator,
): void {
  if (shouldClusterParent(node)) {
    tryClusterFrame(node, childrenByParent, transformByGuid, newGuid);
  }
  for (const child of effectiveChildren(node, childrenByParent)) {
    walk(child, childrenByParent, transformByGuid, newGuid);
  }
}

function tryClusterFrame(
  parent: FigNode,
  childrenByParent: Map<string, readonly FigNode[]>,
  transformByGuid: Map<string, FigMatrix>,
  newGuid: GuidGenerator,
): void {
  const original = effectiveChildren(parent, childrenByParent);
  const visible = original.filter(isVisible);
  if (visible.length < MIN_CHILDREN_FOR_CLUSTERING) {
    return;
  }
  const allBoxes: Box[] = visible
    .map((child, idx) => boxOf(child, idx))
    .filter((b): b is Box => b !== undefined);
  if (allBoxes.length < MIN_CHILDREN_FOR_CLUSTERING) {
    return;
  }
  const choice = pickAxis(allBoxes);
  if (!choice) {
    return;
  }
  const flowBoxes = choice.clusters.flatMap((c) => c.boxes);
  const rebuilt = rebuildParentChildren(parent, flowBoxes, choice.outliers, choice.axis, newGuid, transformByGuid);
  if (rebuilt.length === 0) {
    return;
  }
  // Preserve invisible / non-box children (e.g. layers without a size)
  // so the emitter still sees them. They stay at the end of the list,
  // out of the flow.
  const invisibleOrSizeless = original.filter((child) => {
    if (!isVisible(child)) {
      return true;
    }
    return child.size === undefined;
  });
  childrenByParent.set(guidToString(parent.guid), [...rebuilt, ...invisibleOrSizeless]);
}
