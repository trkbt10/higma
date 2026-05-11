/**
 * @file Build a Godot `Polygon2D` node tree for a fig shape whose
 * geometry comes from a `fillGeometry[].commandsBlob`. Used by
 * `STAR`, `REGULAR_POLYGON`, `VECTOR`, `BOOLEAN_OPERATION`, and
 * `ELLIPSE`-with-arcData.
 *
 * Output shape:
 *
 *   Control            ← Layout slot (placement / size carry on this)
 *     Polygon2D        ← One per filled contour, in fig path order
 *
 * `Polygon2D` is a `Node2D` subclass: it draws by sampling its
 * `polygon: PackedVector2Array` of vertices in the parent CanvasItem's
 * coordinate space (which, for a child of a Control, follows the
 * Control's transformed origin). We emit the vertices in the shape's
 * *local* coordinate space — the wrapping Control's offset_left/top
 * (set by the placement helper in `walk.ts`) carries the shape into
 * the parent frame's coordinate system.
 *
 * Multi-contour fills (e.g. donuts, even-odd VECTOR) emit one
 * Polygon2D per contour and rely on Godot's `polygons` partition to
 * cut the holes. When all contours are CCW (or all CW) Godot fills
 * them as separate islands; mixed-orientation contours fill with the
 * even-odd rule (the default behaviour of triangulation when you set
 * `polygons` to a multi-region partition with reversed orientation).
 *
 * Stroke: not emitted here (a follow-up will add a `Line2D` sibling
 * for stroked vector paths).
 */
import type { FigGradientPaint, FigImagePaint, FigNode, FigPaint, FigSolidPaint } from "@higma-document-models/fig/types";
import { decodePathCommands, type FigBlob } from "@higma-document-models/fig/domain";
import {
  boolVal,
  floatVal,
  intVal,
  node,
  property,
  subResourceRef,
  type GodotNode,
  type GodotProperty,
  type GodotSubResource,
  type GodotValue,
} from "../godot-tree";
import { solidPaintToLine2DColor, solidPaintToPolygon2DColor } from "../style/color";
import { buildGradientFromPaint } from "../style/gradient";
import { flattenPathCommands, type Contour } from "./path-flatten";

/**
 * Decode every visible `commandsBlob` referenced by `node.fillGeometry`
 * and flatten it into one or more polyline contours. Each contour is
 * already in the node's local (object) coordinate space.
 *
 * When the node carries no `fillGeometry` but its type is parametric
 * (`STAR` / `REGULAR_POLYGON`), the contour is synthesised from the
 * node's `size` + `pointCount` (+ `starInnerScale` for stars). The
 * Figma builder writes the parametric shape the same way: the node
 * authoring time records the parameters and the renderer fills it as
 * a regular polygon inscribed in the node's bounding box. We mirror
 * that here so polygon/star cases render even when the .fig export
 * elided the geometry blob.
 */
export function decodeNodeContours(
  node_: FigNode,
  blobs: readonly FigBlob[] | undefined,
): readonly Contour[] {
  // Partial-ellipse arcs / donuts are stored as the full bounding
  // ellipse in `fillGeometry`. The actual visible silhouette comes
  // from `arcData`. Synthesize from parameters first so the blob's
  // full-ellipse shape doesn't override the arc.
  if (node_.type?.name === "ELLIPSE" && node_.arcData) {
    const synth = synthesizeArcContour(node_);
    if (synth.length > 0) {
      return synth;
    }
  }
  const fillGeo = node_.fillGeometry;
  if (fillGeo && fillGeo.length > 0 && blobs) {
    const out: Contour[] = [];
    for (const geom of fillGeo) {
      const idx = geom.commandsBlob;
      if (idx === undefined || idx < 0 || idx >= blobs.length) {
        continue;
      }
      const blob = blobs[idx];
      if (!blob) {
        continue;
      }
      const commands = decodePathCommands(blob);
      if (commands.length === 0) {
        continue;
      }
      for (const contour of flattenPathCommands(commands)) {
        out.push(contour);
      }
    }
    if (out.length > 0) {
      return out;
    }
  }
  // Parametric fallback for STAR / REGULAR_POLYGON / partial ELLIPSE
  // arcs. Skipped for VECTOR / BOOLEAN_OPERATION — those have no
  // parametric form, only a path blob.
  const typeName = node_.type?.name;
  if (typeName === "REGULAR_POLYGON") {
    return synthesizePolygonContour(node_);
  }
  if (typeName === "STAR") {
    return synthesizeStarContour(node_);
  }
  if (typeName === "ELLIPSE") {
    if (node_.arcData) {
      return synthesizeArcContour(node_);
    }
    return synthesizeFullEllipseContour(node_);
  }
  if (typeName === "ROUNDED_RECTANGLE" || typeName === "RECTANGLE") {
    return synthesizeRectangleContour(node_);
  }
  return [];
}

/**
 * Inscribe a rectangle (with optional rounded corners) in the
 * node's authored bounding box. Each corner is sampled at 16
 * intermediate points so corner antialiasing matches a 96-sample
 * ellipse arc.
 *
 * Honours per-corner radii (`rectangleTopLeftCornerRadius` etc.)
 * when set; otherwise falls back to the uniform `cornerRadius`.
 */
function synthesizeRectangleContour(node_: FigNode): readonly Contour[] {
  const size = node_.size;
  if (!size || size.x <= 0 || size.y <= 0) {
    return [];
  }
  const tl = readCornerRadius(node_, "topLeft");
  const tr = readCornerRadius(node_, "topRight");
  const br = readCornerRadius(node_, "bottomRight");
  const bl = readCornerRadius(node_, "bottomLeft");
  const w = size.x;
  const h = size.y;
  if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
    // Plain rectangle.
    return [
      {
        points: [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
        ],
      },
    ];
  }
  const n = 16;
  const arc = (
    cx: number,
    cy: number,
    r: number,
    startAngle: number,
    endAngle: number,
  ): readonly { readonly x: number; readonly y: number }[] => {
    if (r <= 0) {
      return [{ x: cx, y: cy }];
    }
    return Array.from({ length: n + 1 }, (_, k) => {
      const t = k / n;
      const theta = startAngle + (endAngle - startAngle) * t;
      return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
    });
  };
  const tlArc = arc(tl, tl, tl, Math.PI, Math.PI * 1.5);
  const trArc = arc(w - tr, tr, tr, Math.PI * 1.5, Math.PI * 2);
  const brArc = arc(w - br, h - br, br, 0, Math.PI * 0.5);
  const blArc = arc(bl, h - bl, bl, Math.PI * 0.5, Math.PI);
  const points = [...tlArc, ...trArc, ...brArc, ...blArc];
  return [{ points }];
}

/**
 * Read a per-corner radius from a Figma node, falling back to the
 * uniform `cornerRadius` when the per-corner field isn't set.
 */
function readCornerRadius(node_: FigNode, corner: "topLeft" | "topRight" | "bottomRight" | "bottomLeft"): number {
  const fieldMap = {
    topLeft: "rectangleTopLeftCornerRadius",
    topRight: "rectangleTopRightCornerRadius",
    bottomRight: "rectangleBottomRightCornerRadius",
    bottomLeft: "rectangleBottomLeftCornerRadius",
  } as const;
  const perCorner = readNumberField(node_, fieldMap[corner]);
  if (perCorner !== undefined && perCorner > 0) {
    return perCorner;
  }
  if (typeof node_.cornerRadius === "number" && node_.cornerRadius > 0) {
    return node_.cornerRadius;
  }
  return 0;
}

/**
 * Type-guard reader for a numeric property that may not appear in
 * the model's TS shape (per-corner radii, dash spacing, etc.).
 * Returns the value when it's a number, otherwise `undefined`.
 */
function readNumberField(node_: FigNode, key: string): number | undefined {
  if (!node_ || typeof node_ !== "object") {
    return undefined;
  }
  const value = (node_ as { readonly [k: string]: unknown })[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * Inscribe a full ellipse (no `arcData`) in the node's authored
 * bounding box, sampled at 96 points around the perimeter. Produces
 * a single closed contour.
 */
function synthesizeFullEllipseContour(node_: FigNode): readonly Contour[] {
  const size = node_.size;
  if (!size || size.x <= 0 || size.y <= 0) {
    return [];
  }
  const cx = size.x / 2;
  const cy = size.y / 2;
  const rx = size.x / 2;
  const ry = size.y / 2;
  const n = 96;
  const points: { x: number; y: number }[] = [];
  for (const i of Array.from({ length: n }, (_, k) => k)) {
    const theta = (2 * Math.PI * i) / n;
    points.push({ x: cx + rx * Math.cos(theta), y: cy + ry * Math.sin(theta) });
  }
  return [{ points }];
}

/**
 * Build the polyline contour for an ellipse arc / donut.
 *
 * Figma's `arcData` carries:
 *   - `startingAngle` / `endingAngle` in radians measured from the
 *     +x axis of the ellipse's local space, increasing CCW. Sweep
 *     `endingAngle - startingAngle` is the visible angular extent.
 *   - `innerRadius` ∈ [0, 1) — when > 0 the shape is a donut and we
 *     emit two arcs (outer CW, inner CCW) connected at the sweep
 *     endpoints. When `innerRadius === 0` the shape is a pie slice.
 *
 * For full-circle donuts (sweep = 2π, innerRadius > 0) we emit two
 * separate contours so callers (Godot's `Polygon2D`) can mask the hole
 * via opposite winding.
 *
 * Sample density: 96 segments per full sweep gives a 0.5° step which
 * is sub-pixel-accurate at ≤ 240 px diameter.
 */
function synthesizeArcContour(node_: FigNode): readonly Contour[] {
  const size = node_.size;
  const arc = node_.arcData;
  if (!size || !arc || size.x <= 0 || size.y <= 0) {
    return [];
  }
  const TWO_PI = Math.PI * 2;
  const sweep = arc.endingAngle - arc.startingAngle;
  const cx = size.x / 2;
  const cy = size.y / 2;
  const rx = size.x / 2;
  const ry = size.y / 2;
  const inner = Math.max(0, Math.min(1, arc.innerRadius ?? 0));
  const isFullSweep = Math.abs(Math.abs(sweep) - TWO_PI) < 1e-3;
  const samples = Math.max(8, Math.round((96 * Math.abs(sweep)) / TWO_PI));
  // Figma's y-axis is +down, but its `arcData` angles follow the
  // standard math convention (0 = +x, increasing CCW). When mapped
  // into a top-down screen space the arc visually sweeps clockwise.
  const sample = (theta: number, scaleR: number) => ({
    x: cx + rx * scaleR * Math.cos(theta),
    y: cy + ry * scaleR * Math.sin(theta),
  });
  if (inner === 0) {
    // Pie slice — outer arc + line to centre + close.
    const points: { x: number; y: number }[] = [];
    if (!isFullSweep) {
      points.push({ x: cx, y: cy });
    }
    for (const i of Array.from({ length: samples + 1 }, (_, k) => k)) {
      const theta = arc.startingAngle + (sweep * i) / samples;
      points.push(sample(theta, 1));
    }
    return [{ points }];
  }
  if (isFullSweep) {
    // Full ring (donut) — emit the outer + inner rings as TWO
    // separate contours so the stroke path (Line2D) can iterate
    // each ring's own outline. The fill path needs a quad-strip
    // partition connecting outer[i] → inner[i]; we attach that
    // partition to the OUTER contour as a self-contained merged
    // points list, leaving the inner contour as outline-only for
    // stroke. `buildPolygon2DNodes` collects the stroke from the
    // outline contours and the fill from the partitioned outer.
    const outer: { x: number; y: number }[] = [];
    const innerRing: { x: number; y: number }[] = [];
    for (const i of Array.from({ length: samples }, (_, k) => k)) {
      const theta = arc.startingAngle + (TWO_PI * i) / samples;
      outer.push(sample(theta, 1));
      innerRing.push(sample(theta, inner));
    }
    // Build the merged points + partition for fill: alternating
    // outer[i], inner[i], wrapping back to outer[0] at the end.
    const merged: { x: number; y: number }[] = [];
    for (let i = 0; i < samples; i += 1) {
      merged.push(outer[i]);
      merged.push(innerRing[i]);
    }
    const partition: number[][] = [];
    for (let i = 0; i < samples; i += 1) {
      const o0 = (i * 2) % merged.length;
      const i0 = (i * 2 + 1) % merged.length;
      const o1 = ((i + 1) * 2) % merged.length;
      const i1 = ((i + 1) * 2 + 1) % merged.length;
      partition.push([o0, o1, i1, i0]);
    }
    // The merged contour with `partition` carries the fill; the
    // separate outer + inner contours carry the stroke outlines.
    // `buildPolygon2DNodes` uses `partition`-bearing contours for
    // fill and outline-only contours for stroke (Line2D points).
    return [
      { points: merged, partition },
      { points: outer, outlineOnly: true } as Contour,
      { points: innerRing, outlineOnly: true } as Contour,
    ];
  }
  // Partial donut wedge — outer arc forward, inner arc backward,
  // close. One single contour.
  const points: { x: number; y: number }[] = [];
  for (const i of Array.from({ length: samples + 1 }, (_, k) => k)) {
    const theta = arc.startingAngle + (sweep * i) / samples;
    points.push(sample(theta, 1));
  }
  for (const i of Array.from({ length: samples + 1 }, (_, k) => k)) {
    const theta = arc.endingAngle - (sweep * i) / samples;
    points.push(sample(theta, inner));
  }
  return [{ points }];
}

/**
 * Inscribe a regular `n`-gon in the node's authored bounding box.
 *
 * Figma's regular polygon: vertex 0 sits at the top-centre of the
 * bounding box (12-o'clock), subsequent vertices clockwise. The
 * polygon is inscribed in the *ellipse* fitting the box (so a
 * non-square box yields a stretched polygon, matching Figma's own
 * render of a triangle in a 80×60 frame).
 */
function synthesizePolygonContour(node_: FigNode): readonly Contour[] {
  const size = node_.size;
  if (!size || size.x <= 0 || size.y <= 0) {
    return [];
  }
  const n = node_.pointCount ?? 3;
  if (n < 3) {
    return [];
  }
  const cx = size.x / 2;
  const cy = size.y / 2;
  const rx = size.x / 2;
  const ry = size.y / 2;
  const points: { x: number; y: number }[] = [];
  for (const i of Array.from({ length: n }, (_, k) => k)) {
    // Start at -π/2 (top of the box) and walk clockwise.
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / n;
    points.push({ x: cx + rx * Math.cos(theta), y: cy + ry * Math.sin(theta) });
  }
  return [{ points }];
}

/**
 * Inscribe a star with `n` outer vertices in the bounding box.
 * `starInnerScale` (Figma's `Star inner radius`) is the ratio of the
 * inner-vertex radius to the outer-vertex radius. Default 0.382 (the
 * golden-ratio convention Figma's UI ships with).
 *
 * Vertex order: 2n vertices total, alternating outer/inner, starting
 * with the outer vertex at -π/2 (top-centre).
 */
function synthesizeStarContour(node_: FigNode): readonly Contour[] {
  const size = node_.size;
  if (!size || size.x <= 0 || size.y <= 0) {
    return [];
  }
  const n = node_.pointCount ?? 5;
  if (n < 3) {
    return [];
  }
  const innerScale = node_.starInnerScale ?? 0.382;
  const cx = size.x / 2;
  const cy = size.y / 2;
  const rxOuter = size.x / 2;
  const ryOuter = size.y / 2;
  const rxInner = rxOuter * innerScale;
  const ryInner = ryOuter * innerScale;
  const points: { x: number; y: number }[] = [];
  for (const i of Array.from({ length: 2 * n }, (_, k) => k)) {
    const theta = -Math.PI / 2 + (Math.PI * i) / n;
    const isOuter = i % 2 === 0;
    const rx = isOuter ? rxOuter : rxInner;
    const ry = isOuter ? ryOuter : ryInner;
    points.push({ x: cx + rx * Math.cos(theta), y: cy + ry * Math.sin(theta) });
  }
  return [{ points }];
}

/**
 * Pack a contour as a Godot `PackedVector2Array(...)` raw expression
 * embedded in a `polygon` property value.
 */
function contourPolygonProperty(contour: Contour): GodotProperty {
  const text = `PackedVector2Array(${contour.points
    .map((p) => `${formatFloat(p.x)}, ${formatFloat(p.y)}`)
    .join(", ")})`;
  const value: GodotValue = { kind: "raw", text };
  return property("polygon", value);
}

/**
 * Round-tripping helpers — Godot's `.tscn` floats are written without
 * trailing zeros, so emit `1` rather than `1.0` to match the editor's
 * own re-save format.
 */
function formatFloat(n: number): string {
  if (Number.isInteger(n)) {
    return n.toString();
  }
  // Trim to 4 decimal places — sub-pixel precision is wasted on
  // viewport raster output.
  return parseFloat(n.toFixed(4)).toString();
}

/**
 * Result of building Polygon2D nodes for a fig node — both the
 * scene-tree GodotNodes and any sub-resources (Gradient /
 * GradientTexture2D) the caller has to register on the parent
 * scene's sub-resource list.
 */
export type Polygon2DBuildResult = {
  readonly nodes: readonly GodotNode[];
  readonly subResources: readonly GodotSubResource[];
};

/**
 * Build one or more `Polygon2D` nodes for the node's filled silhouette.
 *
 * Single contour → one Polygon2D with the vertices in `polygon`.
 *
 * Multi-contour (donut, even-odd VECTOR, multi-hole boolean result)
 * → one Polygon2D with all vertices concatenated in `polygon` and the
 * `polygons` partition naming each contour as a separate region.
 *
 * SOLID fill → `color = Color(...)` on the Polygon2D.
 *
 * GRADIENT_LINEAR / GRADIENT_RADIAL fill → emits a `Gradient` +
 * `GradientTexture2D` sub-resource pair, attaches the texture to the
 * Polygon2D via `texture = SubResource(...)`, and writes per-vertex
 * `uv = PackedVector2Array(...)` mapping each polygon vertex from the
 * shape's local-space coordinates into the gradient texture's UV
 * space. The gradient transform is applied via the GradientTexture2D's
 * own `fill_from` / `fill_to` so we just emit identity UVs scaled by
 * size.
 *
 * Returns `{ nodes: [], subResources: [] }` when there's no usable
 * fill or no contour.
 */
export function buildPolygon2DNodes(
  node_: FigNode,
  contours: readonly Contour[],
  uniquify: (base: string) => string,
  gradientIdProvider?: { readonly nextGradientId: () => string; readonly nextTextureId: () => string },
  imageProvider?: {
    /**
     * Resolve a single IMAGE paint to its Godot ExtResource id and the
     * image's natural pixel dimensions. Returns `undefined` when the
     * paint can't be resolved (no hash, image not in the doc context),
     * letting the caller drop the paint silently.
     */
    readonly resolveImage: (paint: FigImagePaint) => { readonly id: string; readonly imageWidth: number; readonly imageHeight: number } | undefined;
  },
  rasterizedGradientProvider?: {
    /**
     * Pre-rasterize an angular or diamond gradient paint to an inline
     * `ImageTexture` sub-resource and return its id + dimensions.
     * Used for gradient kinds Godot's `GradientTexture2D` doesn't
     * support natively — see `src/style/gradient-raster.ts` for the
     * pixel-level rasterization.
     */
    readonly resolveAngular: (paint: FigGradientPaint, size: { readonly x: number; readonly y: number }) => { readonly id: string; readonly imageWidth: number; readonly imageHeight: number } | undefined;
    readonly resolveDiamond: (paint: FigGradientPaint, size: { readonly x: number; readonly y: number }) => { readonly id: string; readonly imageWidth: number; readonly imageHeight: number } | undefined;
    /**
     * Pre-rasterize a linear or radial gradient paint to an inline
     * `ImageTexture` (instead of Godot's `GradientTexture2D` whose
     * per-pixel evaluation drifts 1+ bytes vs the WebGL ref). Used
     * for the BOOLEAN_OPERATION / VECTOR polygon paths where the
     * silhouette is irregular and the gradient sampler differences
     * compound — see `bool-gradient-union`.
     */
    readonly resolveLinear?: (paint: FigGradientPaint, size: { readonly x: number; readonly y: number }) => { readonly id: string; readonly imageWidth: number; readonly imageHeight: number } | undefined;
    readonly resolveRadial?: (paint: FigGradientPaint, size: { readonly x: number; readonly y: number }) => { readonly id: string; readonly imageWidth: number; readonly imageHeight: number } | undefined;
  },
  options?: {
    /**
     * When false, emit polygon fill colours WITHOUT the
     * `polygon2DByteCompensate` +0.5-bias compensation. Pass false
     * when the polygon will render into a `CanvasGroup` buffer that
     * gets `self_modulate` alpha-blended afterwards — the +0.5 bias
     * survives the float-precision buffer and overshoots the blended
     * byte by 1. Default true (standalone Polygon2D path).
     */
    readonly compensate?: boolean;
    /**
     * When true, route LINEAR / RADIAL gradient paints through the
     * pre-raster path (`resolveLinear` / `resolveRadial`) instead of
     * Godot's `GradientTexture2D`. The BOOLEAN_OPERATION caller sets
     * this so the irregular silhouette gets a byte-perfect gradient
     * texture matching the WebGL ref.
     */
    readonly preRasterLinearRadial?: boolean;
  },
): Polygon2DBuildResult {
  if (contours.length === 0) {
    return { nodes: [], subResources: [] };
  }
  // Split contours into fill vs outline. Donut / ring shapes
  // produce three contours: a merged-with-partition fill contour,
  // plus two `outlineOnly` rings for the stroke. Plain shapes have
  // a single contour used for both. The fill path skips
  // `outlineOnly` contours; the stroke path skips contours that
  // carry a `partition` (the merged strip would zigzag as a
  // polyline).
  const fillContours = triangulateForFillIfApplicable(contours).filter(
    (c) => c.outlineOnly !== true,
  );
  const strokeContours = contours.filter((c) => c.partition === undefined);
  const strokeNodes = buildStrokeLine2D(node_, strokeContours, uniquify);
  // Stack every visible fill paint as its own Polygon2D, in fig
  // index order. Figma's blend convention paints later entries on
  // top of earlier entries — so a SOLID base with a gradient
  // overlay above produces the gradient blended over the SOLID.
  const fillPaints = node_.fillPaints ?? [];
  const fillNodes: GodotNode[] = [];
  const fillSubResources: GodotSubResource[] = [];
  for (const paint of fillPaints) {
    if (paint.visible === false) {
      continue;
    }
    if (paint.type === "SOLID") {
      const polys = buildSolidPolygon(paint, fillContours, uniquify, options?.compensate ?? true);
      for (const p of polys) {
        fillNodes.push(p);
      }
      continue;
    }
    if (paint.type === "GRADIENT_LINEAR" || paint.type === "GRADIENT_RADIAL") {
      // BOOLEAN_OPERATION / VECTOR paths set
      // `preRasterLinearRadial` to swap Godot's `GradientTexture2D`
      // for a CPU-rasterised inline ImageTexture — the WebGL ref's
      // per-pixel gradient evaluation produces a different byte
      // stream than GradientTexture2D for the irregular polygon
      // silhouettes those paths produce (`bool-gradient-union`
      // 23.23% before this routing).
      //
      // WebGL drives the linear-gradient shader's `u_elementSize`
      // from the merged contour's bounding box, not `node.size`
      // (see fig WebGL renderer.ts drawStencilFill — passes
      // `{ width: bounds.maxX - bounds.minX, ... }`). The two diverge
      // for BOOLEAN_OPERATION nodes whose Figma-authored `size` is
      // looser than the actual merged contour. Pre-rasterising at
      // node.size dimensions would produce a gradient sampled along
      // the wrong axis; rasterising at the contour bounds matches
      // the WebGL ref byte-for-byte.
      if (options?.preRasterLinearRadial && rasterizedGradientProvider) {
        const bounds = contourBoundsOrSize(fillContours, node_.size);
        if (bounds) {
          const gradPaint = paint as FigGradientPaint;
          const sizeForResolve = { x: bounds.width, y: bounds.height };
          const resolved = paint.type === "GRADIENT_LINEAR"
            ? rasterizedGradientProvider.resolveLinear?.(gradPaint, sizeForResolve)
            : rasterizedGradientProvider.resolveRadial?.(gradPaint, sizeForResolve);
          if (resolved) {
            const polys = buildRasterizedGradientPolygon(
              node_,
              fillContours,
              uniquify,
              resolved,
              { x: bounds.x, y: bounds.y },
              sizeForResolve,
            );
            for (const n of polys) {
              fillNodes.push(n);
            }
            continue;
          }
        }
      }
      if (!gradientIdProvider) {
        continue;
      }
      const gradientId = gradientIdProvider.nextGradientId();
      const textureId = gradientIdProvider.nextTextureId();
      const gradient = buildGradientFromPaint(paint as FigGradientPaint, node_.size, gradientId, textureId);
      if (!gradient) {
        continue;
      }
      const built = buildGradientPolygon(node_, fillContours, uniquify, gradient);
      for (const n of built.nodes) {
        fillNodes.push(n);
      }
      for (const sr of built.subResources) {
        fillSubResources.push(sr);
      }
      continue;
    }
    if (paint.type === "IMAGE") {
      if (!imageProvider) {
        continue;
      }
      const imagePaint = paint as FigImagePaint;
      const resolved = imageProvider.resolveImage(imagePaint);
      if (!resolved) {
        continue;
      }
      const polys = buildImagePolygon(node_, fillContours, uniquify, imagePaint, resolved);
      for (const n of polys) {
        fillNodes.push(n);
      }
      continue;
    }
    if (paint.type === "GRADIENT_ANGULAR" || paint.type === "GRADIENT_DIAMOND") {
      if (!rasterizedGradientProvider || !node_.size) {
        continue;
      }
      const gradPaint = paint as FigGradientPaint;
      const resolved = paint.type === "GRADIENT_ANGULAR"
        ? rasterizedGradientProvider.resolveAngular(gradPaint, node_.size)
        : rasterizedGradientProvider.resolveDiamond(gradPaint, node_.size);
      if (!resolved) {
        continue;
      }
      const polys = buildRasterizedGradientPolygon(node_, fillContours, uniquify, resolved);
      for (const n of polys) {
        fillNodes.push(n);
      }
      continue;
    }
  }
  if (fillNodes.length === 0 && strokeNodes.length === 0) {
    return { nodes: [], subResources: [] };
  }
  return {
    nodes: [...fillNodes, ...strokeNodes],
    subResources: fillSubResources,
  };
}

/**
 * Pass-through. The earlier prototype tried to detect outer/inner
 * pairs automatically and triangulate them via
 * `triangulateContoursWithHoles`, but that breaks multi-region
 * VECTOR shapes whose blobs happen to nest (an arrow with an
 * accent rect inside its bounding box rendered as a ring instead
 * of two filled regions). The triangulation is now opt-in:
 * callers that know they have a hole topology pass already-
 * triangulated contours (each carrying its own `partition` field).
 *
 * Donut ELLIPSE / boolean INTERSECT-of-rounded-rects synthesise
 * the partition before reaching `buildPolygon2DNodes` — see
 * `synthesizeArcContour` for full-sweep donuts and
 * `composeBooleanContours` (which delegates to
 * `triangulateContoursWithHoles`) for boolean results.
 */
function triangulateForFillIfApplicable(contours: readonly Contour[]): readonly Contour[] {
  return contours;
}

/**
 * Build a `Line2D` node per contour for the node's stroke. Returns
 * an empty list when there's no visible SOLID stroke. Uses Godot's
 * `Line2D` which paints a polyline with `width = strokeWeight` and
 * the SOLID stroke colour. `closed = true` so the path joins back to
 * the first vertex (matching Figma's stroke-around-the-silhouette
 * convention).
 *
 * Multi-contour silhouettes (donuts, even-odd VECTOR) emit one
 * Line2D per contour so the stroke wraps each region's outline
 * (the donut's outer ring AND inner ring both get stroked, matching
 * Figma's behaviour).
 */
function buildStrokeLine2D(
  node_: FigNode,
  contours: readonly Contour[],
  uniquify: (base: string) => string,
): readonly GodotNode[] {
  const stroke = firstVisibleSolidStroke(node_.strokePaints);
  if (!stroke) {
    return [];
  }
  const width = readUniformStrokeWeight(node_.strokeWeight);
  if (width <= 0) {
    return [];
  }
  const colorVal = solidPaintToLine2DColor(stroke);
  return contours.map((contour, idx) => {
    const pointsText = contour.points
      .map((p) => `${formatFloat(p.x)}, ${formatFloat(p.y)}`)
      .join(", ");
    const pointsValue: GodotValue = {
      kind: "raw",
      text: `PackedVector2Array(${pointsText})`,
    };
    const props: GodotProperty[] = [
      property("points", pointsValue),
      property("width", floatVal(width)),
      property("default_color", colorVal),
      property("closed", boolVal(true)),
      // Disable Line2D's joint segment overlap fill — without this,
      // sharp joins paint extra triangles past the corner that the
      // WebGL reference doesn't draw. `BEGIN_CAP_BOX = 2` /
      // `END_CAP_BOX = 2` keep the start/end caps flat (aligned with
      // the closed-loop convention).
      property("joint_mode", intVal(2 /* LINE_JOINT_ROUND */)),
    ];
    const baseName = idx === 0 ? "Stroke" : `Stroke${idx + 1}`;
    return node(uniquify(baseName), "Line2D", { properties: props });
  });
}

/**
 * Resolve the uniform stroke weight from a Figma node. The model
 * stores `strokeWeight` as either a scalar number or a
 * `{ top, right, bottom, left }` per-side struct; we use `top` as the
 * canonical value when independent weights are set (the polygon path
 * doesn't yet support per-side stroke widths).
 */
function readUniformStrokeWeight(weight: FigNode["strokeWeight"]): number {
  if (weight === undefined) {
    return 0;
  }
  if (typeof weight === "number") {
    return weight;
  }
  return weight.top ?? 0;
}

/**
 * First visible SOLID stroke paint, mirroring `firstVisibleSolidFill`.
 */
function firstVisibleSolidStroke(paints: readonly FigPaint[] | undefined): FigSolidPaint | undefined {
  if (!paints) {
    return undefined;
  }
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    if (paint.type === "SOLID") {
      return paint;
    }
  }
  return undefined;
}

/**
 * Compute the bounding box of all contour vertices, returning an
 * `(x, y, width, height)` object. Falls back to `(0, 0, size.x,
 * size.y)` from the node when contours are empty.
 *
 * Used by the BOOLEAN_OPERATION gradient rasterisation path so the
 * gradient texture spans only the merged silhouette's actual extent
 * — matching the WebGL ref's `elementSize = bounds.{w,h}` (see
 * `renderer.ts` `drawStencilFill`).
 */
function contourBoundsOrSize(
  contours: readonly Contour[],
  fallback: { readonly x: number; readonly y: number } | undefined,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const c of contours) {
    for (const p of c.points) {
      if (p.x < minX) {
        minX = p.x;
      }
      if (p.y < minY) {
        minY = p.y;
      }
      if (p.x > maxX) {
        maxX = p.x;
      }
      if (p.y > maxY) {
        maxY = p.y;
      }
      any = true;
    }
  }
  if (!any) {
    if (!fallback || fallback.x <= 0 || fallback.y <= 0) {
      return undefined;
    }
    return { x: 0, y: 0, width: fallback.x, height: fallback.y };
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return { x: minX, y: minY, width, height };
}

function buildSolidPolygon(
  fill: FigSolidPaint,
  contours: readonly Contour[],
  uniquify: (base: string) => string,
  compensate: boolean = true,
): readonly GodotNode[] {
  const colorVal = solidPaintToPolygon2DColor(fill, compensate);
  if (contours.length === 1 && !contours[0].partition) {
    const props: GodotProperty[] = [
      property("color", colorVal),
      contourPolygonProperty(contours[0]),
    ];
    return [node(uniquify("Fill"), "Polygon2D", { properties: props })];
  }
  const { polygonValue, polygonsValue } = packMultiContour(contours);
  const props: GodotProperty[] = [
    property("color", colorVal),
    property("polygon", polygonValue),
    property("polygons", polygonsValue),
  ];
  return [node(uniquify("Fill"), "Polygon2D", { properties: props })];
}

/**
 * Build a Polygon2D backed by a GradientTexture2D. UVs map each
 * vertex `(x, y)` from local shape space into the texture's `[0,1]²`
 * sample space using the node's authored size as the divisor. The
 * gradient direction (linear) and centre/radius (radial) are baked
 * into the GradientTexture2D's `fill_from` / `fill_to`, so we don't
 * have to reapply the gradient transform here.
 */
function buildGradientPolygon(
  node_: FigNode,
  contours: readonly Contour[],
  uniquify: (base: string) => string,
  gradient: { readonly subResources: readonly GodotSubResource[]; readonly textureProperty: GodotProperty },
): Polygon2DBuildResult {
  const size = node_.size;
  if (!size || size.x <= 0 || size.y <= 0) {
    return { nodes: [], subResources: [] };
  }
  const allPoints: { readonly x: number; readonly y: number }[] = [];
  const partitions: number[][] = [];
  // `needsPartitions` is true when ANY contour carries an explicit
  // partition (donut ring) OR when there are multiple contours (so
  // each one needs to land in its own `polygons` region). Computed
  // up-front so the loop below stays a pure accumulator.
  const needsPartitions =
    contours.length > 1 ||
    contours.some((c) => c.partition !== undefined && c.partition.length > 0);
  for (const contour of contours) {
    const baseIndex = allPoints.length;
    for (const p of contour.points) {
      allPoints.push(p);
    }
    if (contour.partition && contour.partition.length > 0) {
      for (const region of contour.partition) {
        partitions.push(region.map((idx) => baseIndex + idx));
      }
    } else {
      const ids: number[] = [];
      for (let i = 0; i < contour.points.length; i += 1) {
        ids.push(baseIndex + i);
      }
      partitions.push(ids);
    }
  }
  const polygonValue: GodotValue = {
    kind: "raw",
    text: `PackedVector2Array(${allPoints
      .map((p) => `${formatFloat(p.x)}, ${formatFloat(p.y)}`)
      .join(", ")})`,
  };
  // Polygon2D's `uv` is in the texture's own coord space (pixels).
  // GradientTexture2D's pixel space matches its `width` × `height`
  // (which `buildLinearGradient` set to the node's size). So the UVs
  // are simply the polygon's own vertex coordinates — Godot then
  // samples the texture at those positions, applying its `fill_from`
  // / `fill_to` direction.
  const uvValue: GodotValue = {
    kind: "raw",
    text: `PackedVector2Array(${allPoints
      .map((p) => `${formatFloat(p.x)}, ${formatFloat(p.y)}`)
      .join(", ")})`,
  };
  const props: GodotProperty[] = [
    gradient.textureProperty,
    property("polygon", polygonValue),
    property("uv", uvValue),
  ];
  if (needsPartitions) {
    const polygonsValue: GodotValue = {
      kind: "raw",
      text: `[${partitions
        .map((region) => `PackedInt32Array(${region.join(", ")})`)
        .join(", ")}]`,
    };
    props.push(property("polygons", polygonsValue));
  }
  const polygonNode = node(uniquify("Fill"), "Polygon2D", { properties: props });
  return { nodes: [polygonNode], subResources: gradient.subResources };
}

/**
 * Build a `Polygon2D` textured with a fig IMAGE paint. The image is
 * supplied by `resolved` (a Godot `ExtResource` id and the image's
 * natural pixel dimensions) and the paint controls how the image maps
 * to the shape via its `scaleMode` field.
 *
 * UV layout: Polygon2D's per-vertex `uv` is in texture-pixel space.
 * For `STRETCH` (the only scale mode this v0 implementation honours),
 * a vertex at shape-local position `(x, y)` samples the texture at
 * `(x * imgW / shapeW, y * imgH / shapeH)` — i.e. linearly stretches
 * the full image across the shape's bounding box. We bake that
 * mapping into the per-vertex `uv` array so Godot's Polygon2D
 * rasteriser doesn't have to apply any `texture_scale`.
 *
 * Other scale modes (`FILL`, `FIT`, `TILE`, `CROP`) are not yet
 * modelled — they all currently fall through this same STRETCH path,
 * which is wrong for those modes but produces a sensible-looking
 * result for the v0 fixtures (none of which exercise them yet).
 */
function buildImagePolygon(
  node_: FigNode,
  contours: readonly Contour[],
  uniquify: (base: string) => string,
  paint: FigImagePaint,
  resolved: { readonly id: string; readonly imageWidth: number; readonly imageHeight: number },
): readonly GodotNode[] {
  const size = node_.size;
  if (!size || size.x <= 0 || size.y <= 0) {
    return [];
  }
  const allPoints: { readonly x: number; readonly y: number }[] = [];
  const partitions: number[][] = [];
  const needsPartitions =
    contours.length > 1 ||
    contours.some((c) => c.partition !== undefined && c.partition.length > 0);
  for (const contour of contours) {
    const baseIndex = allPoints.length;
    for (const p of contour.points) {
      allPoints.push(p);
    }
    if (contour.partition && contour.partition.length > 0) {
      for (const region of contour.partition) {
        partitions.push(region.map((idx) => baseIndex + idx));
      }
    } else {
      const ids: number[] = [];
      for (let i = 0; i < contour.points.length; i += 1) {
        ids.push(baseIndex + i);
      }
      partitions.push(ids);
    }
  }
  const polygonValue: GodotValue = {
    kind: "raw",
    text: `PackedVector2Array(${allPoints
      .map((p) => `${formatFloat(p.x)}, ${formatFloat(p.y)}`)
      .join(", ")})`,
  };
  // STRETCH UV: each vertex's shape-local fraction (x/w, y/h) maps to
  // (uv.x = fraction.x * imgW, uv.y = fraction.y * imgH). Polygon2D
  // samples the texture at those pixel positions; with the texture
  // exactly imgW × imgH, the corners of the shape land on the corners
  // of the texture and the interior is bilinearly interpolated.
  const sx = resolved.imageWidth / size.x;
  const sy = resolved.imageHeight / size.y;
  const uvValue: GodotValue = {
    kind: "raw",
    text: `PackedVector2Array(${allPoints
      .map((p) => `${formatFloat(p.x * sx)}, ${formatFloat(p.y * sy)}`)
      .join(", ")})`,
  };
  const props: GodotProperty[] = [
    // Force linear (bilinear) texture filtering. Godot's default for
    // a CanvasItem is `INHERIT` (0) which on a fresh `ImageTexture`
    // emitted as a sub-resource resolves to NEAREST in headless
    // gl_compatibility. The WebGL reference samples bilinearly, so
    // a 4×4 source PNG stretched to 120×80 produces smooth mid-tone
    // gradients in the ref but blocky cells in our render. Setting
    // `texture_filter = 2 /* LINEAR */` aligns the two.
    property("texture_filter", intVal(2 /* LINEAR */)),
    property("texture", subResourceRef(resolved.id)),
    property("polygon", polygonValue),
    property("uv", uvValue),
  ];
  // Paint-level opacity: Figma stores `opacity` on each `FigPaint`
  // entry independently of the colour's own alpha. For SOLID and
  // gradient paths the colour-emit helpers fold that into the
  // Polygon2D's `color` / Gradient stop alpha. Polygon2D's `texture`
  // path has no per-paint alpha control — instead we apply the
  // opacity through the Polygon2D's own `self_modulate` Color, which
  // multiplies into the texture sample at draw time. Skipped for
  // fully-opaque paints so the round-trip of plain image fills stays
  // diff-clean.
  const paintOpacity = typeof paint.opacity === "number" ? paint.opacity : 1;
  if (paintOpacity < 1 - 1e-6) {
    props.push(
      property("self_modulate", {
        kind: "color",
        r: 1,
        g: 1,
        b: 1,
        a: paintOpacity,
      }),
    );
  }
  if (needsPartitions) {
    const polygonsValue: GodotValue = {
      kind: "raw",
      text: `[${partitions
        .map((region) => `PackedInt32Array(${region.join(", ")})`)
        .join(", ")}]`,
    };
    props.push(property("polygons", polygonsValue));
  }
  return [node(uniquify("Fill"), "Polygon2D", { properties: props })];
}

/**
 * Build a `Polygon2D` textured with a pre-rasterized angular or
 * diamond gradient. The texture is the same dimensions as the node's
 * authored size, so the UV mapping is identity (each shape-local
 * vertex's coords are also its UV in texture-pixel space).
 *
 * Bilinear filtering is force-set so Godot's gl_compat default
 * NEAREST doesn't produce visibly blocky stop transitions on small
 * source dimensions.
 */
function buildRasterizedGradientPolygon(
  node_: FigNode,
  contours: readonly Contour[],
  uniquify: (base: string) => string,
  resolved: { readonly id: string; readonly imageWidth: number; readonly imageHeight: number },
  textureOrigin?: { readonly x: number; readonly y: number },
  textureSize?: { readonly x: number; readonly y: number },
): readonly GodotNode[] {
  // Default to the node's authored size when no explicit texture
  // mapping size is provided. Callers using a contour-bounds
  // rasterisation should pass `textureSize = { x: bounds.width,
  // y: bounds.height }` so UV maps the bounds region to the full
  // texture, not the node's authored extent.
  const size = textureSize ?? node_.size;
  if (!size || size.x <= 0 || size.y <= 0) {
    return [];
  }
  const allPoints: { readonly x: number; readonly y: number }[] = [];
  const partitions: number[][] = [];
  const needsPartitions =
    contours.length > 1 ||
    contours.some((c) => c.partition !== undefined && c.partition.length > 0);
  for (const contour of contours) {
    const baseIndex = allPoints.length;
    for (const p of contour.points) {
      allPoints.push(p);
    }
    if (contour.partition && contour.partition.length > 0) {
      for (const region of contour.partition) {
        partitions.push(region.map((idx) => baseIndex + idx));
      }
    } else {
      const ids: number[] = [];
      for (let i = 0; i < contour.points.length; i += 1) {
        ids.push(baseIndex + i);
      }
      partitions.push(ids);
    }
  }
  const polygonValue: GodotValue = {
    kind: "raw",
    text: `PackedVector2Array(${allPoints
      .map((p) => `${formatFloat(p.x)}, ${formatFloat(p.y)}`)
      .join(", ")})`,
  };
  // UV mapping: a shape-local vertex `(Vx, Vy)` samples texture pixel
  // `((Vx - origin.x) * imgW / size.x, (Vy - origin.y) * imgH / size.y)`.
  // For the default (no origin) the texture spans `node.size` from the
  // shape's local origin. For BOOLEAN_OPERATION / VECTOR (caller passes
  // the contour-bounds origin + size), the texture spans only the
  // merged contour bounds, so vertices at the bounds' min map to (0, 0)
  // and at max map to (imgW, imgH).
  const originX = textureOrigin?.x ?? 0;
  const originY = textureOrigin?.y ?? 0;
  const sx = resolved.imageWidth / size.x;
  const sy = resolved.imageHeight / size.y;
  const uvValue: GodotValue = {
    kind: "raw",
    text: `PackedVector2Array(${allPoints
      .map((p) => `${formatFloat((p.x - originX) * sx)}, ${formatFloat((p.y - originY) * sy)}`)
      .join(", ")})`,
  };
  const props: GodotProperty[] = [
    property("texture_filter", intVal(2 /* LINEAR */)),
    property("texture", subResourceRef(resolved.id)),
    property("polygon", polygonValue),
    property("uv", uvValue),
  ];
  if (needsPartitions) {
    const polygonsValue: GodotValue = {
      kind: "raw",
      text: `[${partitions
        .map((region) => `PackedInt32Array(${region.join(", ")})`)
        .join(", ")}]`,
    };
    props.push(property("polygons", polygonsValue));
  }
  return [node(uniquify("Fill"), "Polygon2D", { properties: props })];
}

/**
 * Concatenate every contour into a flat `polygon` array and produce
 * a `polygons` partition naming each contour (or pre-computed
 * triangulation region) as a separate fillable region. Used by both
 * the SOLID and gradient builders for multi-contour fills.
 */
function packMultiContour(
  contours: readonly Contour[],
): { readonly polygonValue: GodotValue; readonly polygonsValue: GodotValue } {
  const allPoints: { readonly x: number; readonly y: number }[] = [];
  const partitions: number[][] = [];
  for (const contour of contours) {
    const baseIndex = allPoints.length;
    for (const p of contour.points) {
      allPoints.push(p);
    }
    if (contour.partition && contour.partition.length > 0) {
      for (const region of contour.partition) {
        partitions.push(region.map((idx) => baseIndex + idx));
      }
    } else {
      const ids: number[] = [];
      for (let i = 0; i < contour.points.length; i += 1) {
        ids.push(baseIndex + i);
      }
      partitions.push(ids);
    }
  }
  const polygonValue: GodotValue = {
    kind: "raw",
    text: `PackedVector2Array(${allPoints
      .map((p) => `${formatFloat(p.x)}, ${formatFloat(p.y)}`)
      .join(", ")})`,
  };
  const polygonsValue: GodotValue = {
    kind: "raw",
    text: `[${partitions
      .map((region) => `PackedInt32Array(${region.join(", ")})`)
      .join(", ")}]`,
  };
  return { polygonValue, polygonsValue };
}

/**
 * Convenience: package the decoded path into a single record so the
 * caller can decide between SOLID emission, stroke emission, or fail-
 * through to placeholder.
 */
export type DecodedShapeFill = {
  readonly contours: readonly Contour[];
  readonly polygons: readonly GodotNode[];
  readonly subResources: readonly GodotSubResource[];
};

/**
 * One-shot helper that bundles `decodeNodeContours` +
 * `buildPolygon2DNodes` so call-sites that just want "produce the
 * Polygon2D nodes for this fig node, given the doc-level blob array"
 * don't have to duplicate the wiring.
 */
export function buildDecodedShapeFill(
  node_: FigNode,
  blobs: readonly FigBlob[] | undefined,
  uniquify: (base: string) => string,
  gradientIdProvider?: { readonly nextGradientId: () => string; readonly nextTextureId: () => string },
): DecodedShapeFill {
  const contours = decodeNodeContours(node_, blobs);
  const result = buildPolygon2DNodes(node_, contours, uniquify, gradientIdProvider);
  return { contours, polygons: result.nodes, subResources: result.subResources };
}
