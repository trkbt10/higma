/**
 * @file Public path primitive types shared by every domain that
 * decodes, builds, transforms, or serialises path data. SoT for the
 * `PathCommand` discriminated union plus the supporting types
 * (`PathContour`, `SvgPathOptions`, `AffineMatrix`, `CornerRadius`,
 * `Bbox`).
 */

/**
 * Path command — SoT shape used by every package that reads or writes
 * 2D path data.
 *
 * Property names follow SVG path data conventions:
 * - C command: x1 y1 x2 y2 x y (two control points + endpoint)
 * - Q command: x1 y1 x y (one control point + endpoint)
 * - A command: SVG-style elliptical arc (rx, ry, rotation, largeArc,
 *   sweep, x, y)
 *
 * Both the Kiwi `.fig` blob decoder and the SVG path-`d` parser emit
 * values of this one union. The blob decoder only emits
 * M / L / C / Q / Z (its byte alphabet has no Arc primitive); Arc is
 * reached exclusively through the SVG-`d` channel. The variant sits
 * here because downstream consumers — boolean-compose, geometry
 * emitters, godot/swiftui translators, tessellator — routinely consume
 * the merged output of both decoders.
 */
export type PathCommand =
  | { readonly type: "M"; readonly x: number; readonly y: number }
  | { readonly type: "L"; readonly x: number; readonly y: number }
  | {
      readonly type: "C";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: "Q";
      readonly x1: number;
      readonly y1: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: "A";
      readonly rx: number;
      readonly ry: number;
      readonly rotation: number;
      readonly largeArc: boolean;
      readonly sweep: boolean;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: "Z" };

/**
 * Path contour — a single connected commands sequence with a
 * fill-winding rule.
 *
 * `fillRule` is an optional per-contour override (used by vector nodes
 * with a `styleOverrideTable`). When absent the consumer falls back to
 * the contour's `windingRule` for fill evaluation.
 */
export type PathContour = {
  readonly commands: readonly PathCommand[];
  readonly windingRule: "nonzero" | "evenodd";
  readonly fillRule?: "nonzero" | "evenodd";
};

/** Options for SVG path-`d` serialisation. */
export type SvgPathOptions = {
  /** Decimal precision (default: 2). */
  readonly precision?: number;
  /**
   * Separator between command letter and coordinates.
   * - " " (default): `"M 0.00 0.00 L 10.00 0.00"`
   * - ""  (compact): `"M0 0L10 0"`
   */
  readonly separator?: string;
};

/**
 * Domain-free 2x3 affine transform matrix.
 *
 * Convention matches every existing path consumer (svg `matrix(...)`,
 * Figma's FigMatrix, Canvas2D transform):
 *
 *   [ m00 m01 m02 ]   [ x ]
 *   [ m10 m11 m12 ] * [ y ]
 *   [  0   0   1  ]   [ 1 ]
 *
 * Defined locally rather than borrowed from `@higma-document-models/fig`
 * so this primitive stays in layer 0 (no dependency on the fig domain).
 */
export type AffineMatrix = {
  readonly m00: number;
  readonly m01: number;
  readonly m02: number;
  readonly m10: number;
  readonly m11: number;
  readonly m12: number;
};

/**
 * Corner radius for rectangular shapes.
 * - number: uniform radius on all corners
 * - [tl, tr, br, bl]: per-corner radii
 */
export type CornerRadius = number | readonly [number, number, number, number];

/**
 * Axis-aligned bounding box returned by `pathCommandsBoundingBox`.
 *
 * `(x, y)` is the top-left corner; `(w, h)` are non-negative widths.
 */
export type Bbox = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};
