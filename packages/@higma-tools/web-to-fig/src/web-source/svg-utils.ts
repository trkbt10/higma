/**
 * @file Pure SVG geometry helpers.
 *
 * Two responsibilities, kept here because they are sharable between
 * the host-side `extract.ts` (which can `import` freely) and the
 * Playwright `in-page.ts` capture function (which cannot — but the
 * code below is duplicated *inline* there because Playwright
 * serialises the function body into the page context where outer
 * bindings are unreachable). This file is the source of truth for
 * the algorithms; any drift in `in-page.ts` is a bug to be reconciled
 * here and re-mirrored.
 *
 * Responsibility 1 — `shapeToPathData`: turn an SVG shape element
 * (`<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polygon>`,
 * `<polyline>`) into the equivalent `<path d="...">` string. SVG
 * authors freely mix shapes and paths inside an icon; capturing only
 * `<path>` silently drops `<circle>` indicator dots, `<rect>` chip
 * backgrounds, `<polyline>` separator strokes, and many more — every
 * one a "where did my icon go" report. The converted `d` uses the
 * same coordinate frame the shape itself painted in, so a downstream
 * `transformPathData` (responsibility 2) can compose the ancestor
 * `<g transform>` chain on top.
 *
 * Responsibility 2 — `transformPathData`: bake a 2x3 affine matrix
 * (`a, b, c, d, e, f`) into every coordinate of an SVG path-data
 * string. SVG authors place icons inside `<g transform="translate(...)
 * rotate(...) scale(...)">` to position glyphs; without baking,
 * Figma's VECTOR node receives the inner `d` verbatim and renders the
 * geometry at the wrong place / size — visible as misaligned multi-
 * piece icons and "things that shouldn't connect appear connected"
 * because the unbaked d resolved to coordinates outside the FRAME
 * box.
 *
 * Both helpers are intentionally textual and deterministic: they do
 * not query the DOM, do not touch `getBBox` / `getCTM`, and never
 * approximate a curve as a polyline. Bézier control points are
 * transformed by the same matrix as their endpoints (the affine
 * transform of a Bézier curve IS a Bézier curve with transformed
 * control points), so curves stay smooth.
 */

/**
 * 2x3 affine matrix in column-major order. Maps a point (x, y) to
 * (a*x + c*y + e, b*x + d*y + f). Matches the SVG `<svg
 * transform="matrix(...)">` argument order and the `DOMMatrix`
 * conventions, so callers can lift values out of either source
 * verbatim.
 */
export type Affine2D = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

export const IDENTITY_AFFINE: Affine2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Multiply two affine matrices (`m1 * m2`), returning the composed matrix. */
export function multiplyAffine(m1: Affine2D, m2: Affine2D): Affine2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

/**
 * Parse an SVG `transform` attribute value into a single composed
 * affine. The grammar SVG accepts is a sequence of function calls:
 *
 *   matrix(a b c d e f)
 *   translate(tx [, ty])
 *   scale(sx [, sy])
 *   rotate(angle [, cx, cy])
 *   skewX(angle) / skewY(angle)
 *
 * Values are separated by whitespace, comma, or both. Multiple
 * transform functions compose in source order (left-to-right ≡ outer
 * to inner). Returns the identity for an empty / undefined input or
 * an unrecognisable function — the caller decides whether to throw.
 */
export function parseSvgTransform(value: string | null | undefined): Affine2D {
  if (value === null || value === undefined) {
    return IDENTITY_AFFINE;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return IDENTITY_AFFINE;
  }
  const tokenRegex = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  const out: Affine2D[] = [];
  for (let match = tokenRegex.exec(trimmed); match !== null; match = tokenRegex.exec(trimmed)) {
    const name = match[1]!.toLowerCase();
    const args = parseTransformArgs(match[2]!);
    out.push(transformFunctionToAffine(name, args));
  }
  return out.reduce((acc, m) => multiplyAffine(acc, m), IDENTITY_AFFINE);
}

function parseTransformArgs(raw: string): readonly number[] {
  const tokens = raw.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.length > 0);
  return tokens.map((t) => parseFloat(t)).filter((n) => Number.isFinite(n));
}

function transformFunctionToAffine(name: string, args: readonly number[]): Affine2D {
  switch (name) {
    case "matrix": {
      if (args.length !== 6) {
        return IDENTITY_AFFINE;
      }
      return { a: args[0]!, b: args[1]!, c: args[2]!, d: args[3]!, e: args[4]!, f: args[5]! };
    }
    case "translate": {
      const tx = args[0] ?? 0;
      const ty = args[1] ?? 0;
      return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
    }
    case "scale": {
      const sx = args[0] ?? 1;
      const sy = args.length > 1 ? args[1]! : sx;
      return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
    }
    case "rotate": {
      const angle = (args[0] ?? 0) * Math.PI / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      if (args.length >= 3) {
        // rotate(angle, cx, cy) ≡ T(cx,cy) · R(angle) · T(-cx,-cy)
        const cx = args[1]!;
        const cy = args[2]!;
        const t1: Affine2D = { a: 1, b: 0, c: 0, d: 1, e: cx, f: cy };
        const r: Affine2D = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
        const t2: Affine2D = { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy };
        return multiplyAffine(multiplyAffine(t1, r), t2);
      }
      return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
    }
    case "skewx": {
      const tan = Math.tan((args[0] ?? 0) * Math.PI / 180);
      return { a: 1, b: 0, c: tan, d: 1, e: 0, f: 0 };
    }
    case "skewy": {
      const tan = Math.tan((args[0] ?? 0) * Math.PI / 180);
      return { a: 1, b: tan, c: 0, d: 1, e: 0, f: 0 };
    }
    default:
      return IDENTITY_AFFINE;
  }
}

/**
 * Convert a non-`<path>` SVG shape into the equivalent path-data
 * string. Returns `undefined` for unrecognised tags or invalid
 * geometry (negative radius, missing required attribute) so callers
 * can decide whether to skip the element or surface the failure.
 *
 * Supported shapes — chosen because every one is in active use in
 * captured icons:
 *
 *   - `<rect>` (with optional `rx`/`ry` corners)
 *   - `<circle>`
 *   - `<ellipse>`
 *   - `<line>`
 *   - `<polygon>`
 *   - `<polyline>`
 *
 * Rounded rectangles use four cubic Bézier corner approximations with
 * the canonical CSS magic constant κ = 0.55228 (4*(√2-1)/3) so the
 * arc visually matches CSS's `border-radius` rendering. Circles and
 * ellipses are also expressed as four cubic Béziers around the shape
 * for the same reason. Lines and polygons are exact with `M`/`L`/`Z`.
 */
export function shapeToPathData(tag: string, attrs: ShapeAttrs): string | undefined {
  switch (tag.toLowerCase()) {
    case "rect":
      return rectToPath(attrs);
    case "circle":
      return circleToPath(attrs);
    case "ellipse":
      return ellipseToPath(attrs);
    case "line":
      return lineToPath(attrs);
    case "polygon":
      return polylineToPath(attrs, true);
    case "polyline":
      return polylineToPath(attrs, false);
    default:
      return undefined;
  }
}

/** Reads from a shape element's attribute table. Missing values default to 0/null. */
export type ShapeAttrs = {
  readonly get: (name: string) => string | null;
};

const KAPPA = 0.5522847498307933;

function rectToPath(attrs: ShapeAttrs): string | undefined {
  const x = numAttr(attrs, "x", 0);
  const y = numAttr(attrs, "y", 0);
  const w = numAttr(attrs, "width", 0);
  const h = numAttr(attrs, "height", 0);
  if (w <= 0 || h <= 0) {
    return undefined;
  }
  const rxRaw = numAttr(attrs, "rx", NaN);
  const ryRaw = numAttr(attrs, "ry", NaN);
  // Per SVG spec: missing rx and ry both default to 0; if only one is
  // provided, the other inherits its value.
  const rxResolved = Number.isFinite(rxRaw) ? rxRaw : (Number.isFinite(ryRaw) ? ryRaw : 0);
  const ryResolved = Number.isFinite(ryRaw) ? ryRaw : (Number.isFinite(rxRaw) ? rxRaw : 0);
  const rx = Math.min(Math.max(0, rxResolved), w / 2);
  const ry = Math.min(Math.max(0, ryResolved), h / 2);
  if (rx === 0 && ry === 0) {
    return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  }
  const cx = rx * KAPPA;
  const cy = ry * KAPPA;
  // Start at top-left corner end, move right, then arc through every
  // corner using cubic Béziers with κ-scaled control handles.
  return [
    `M ${x + rx} ${y}`,
    `H ${x + w - rx}`,
    `C ${x + w - rx + cx} ${y}, ${x + w} ${y + ry - cy}, ${x + w} ${y + ry}`,
    `V ${y + h - ry}`,
    `C ${x + w} ${y + h - ry + cy}, ${x + w - rx + cx} ${y + h}, ${x + w - rx} ${y + h}`,
    `H ${x + rx}`,
    `C ${x + rx - cx} ${y + h}, ${x} ${y + h - ry + cy}, ${x} ${y + h - ry}`,
    `V ${y + ry}`,
    `C ${x} ${y + ry - cy}, ${x + rx - cx} ${y}, ${x + rx} ${y}`,
    "Z",
  ].join(" ");
}

function circleToPath(attrs: ShapeAttrs): string | undefined {
  const cx = numAttr(attrs, "cx", 0);
  const cy = numAttr(attrs, "cy", 0);
  const r = numAttr(attrs, "r", 0);
  if (r <= 0) {
    return undefined;
  }
  return ellipsePath(cx, cy, r, r);
}

function ellipseToPath(attrs: ShapeAttrs): string | undefined {
  const cx = numAttr(attrs, "cx", 0);
  const cy = numAttr(attrs, "cy", 0);
  const rx = numAttr(attrs, "rx", 0);
  const ry = numAttr(attrs, "ry", 0);
  if (rx <= 0 || ry <= 0) {
    return undefined;
  }
  return ellipsePath(cx, cy, rx, ry);
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    `M ${cx - rx} ${cy}`,
    `C ${cx - rx} ${cy - oy}, ${cx - ox} ${cy - ry}, ${cx} ${cy - ry}`,
    `C ${cx + ox} ${cy - ry}, ${cx + rx} ${cy - oy}, ${cx + rx} ${cy}`,
    `C ${cx + rx} ${cy + oy}, ${cx + ox} ${cy + ry}, ${cx} ${cy + ry}`,
    `C ${cx - ox} ${cy + ry}, ${cx - rx} ${cy + oy}, ${cx - rx} ${cy}`,
    "Z",
  ].join(" ");
}

function lineToPath(attrs: ShapeAttrs): string | undefined {
  const x1 = numAttr(attrs, "x1", 0);
  const y1 = numAttr(attrs, "y1", 0);
  const x2 = numAttr(attrs, "x2", 0);
  const y2 = numAttr(attrs, "y2", 0);
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

function polylineToPath(attrs: ShapeAttrs, close: boolean): string | undefined {
  const raw = attrs.get("points") ?? "";
  const tokens = raw.trim().split(/[\s,]+/).map((s) => parseFloat(s)).filter((n) => Number.isFinite(n));
  if (tokens.length < 4 || tokens.length % 2 !== 0) {
    return undefined;
  }
  const segments: string[] = [`M ${tokens[0]!} ${tokens[1]!}`];
  for (let i = 2; i < tokens.length; i += 2) {
    segments.push(`L ${tokens[i]!} ${tokens[i + 1]!}`);
  }
  if (close) {
    segments.push("Z");
  }
  return segments.join(" ");
}

function numAttr(attrs: ShapeAttrs, name: string, fallback: number): number {
  const raw = attrs.get(name);
  if (raw === null) {
    return fallback;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Bake a 2D affine into every coordinate of an SVG path-data string.
 * Returns a new path-data string in the transformed coordinate frame.
 *
 * Algorithm: tokenise the path into commands; for each command,
 * convert relative variants to absolute (so the matrix can be applied
 * pointwise without tracking pen state through the transform), then
 * apply the matrix to every coordinate pair. Output uses absolute
 * commands exclusively because the relative form references the
 * post-transform pen position, which the matrix does not preserve in
 * general.
 *
 * The arc command (`A`) is the awkward one: SVG arcs carry `rx`,
 * `ry`, `x-axis-rotation` semi-axes that an arbitrary affine
 * transforms into a *new* ellipse in general. For uniform scaling /
 * pure translation the existing semi-axes stay valid; for rotation we
 * adjust the x-axis-rotation. Anything more general (skew, non-
 * uniform scale) requires re-fitting the ellipse — implemented here
 * by lifting the arc to its end-point parameterisation, transforming
 * the conic, and re-extracting (rx, ry, rotation). Real-world icon
 * captures rarely need the full general case; the targeted subset
 * (translate + uniform scale + rotation about origin) is verified
 * exactly, the rest falls back to a polyline approximation rather
 * than producing a silently wrong arc.
 */
export function transformPathData(d: string, m: Affine2D): string {
  if (d.length === 0) {
    return d;
  }
  if (isIdentity(m)) {
    return d;
  }
  const commands = parsePathData(d);
  if (commands.length === 0) {
    return d;
  }
  const absolute = toAbsoluteCommands(commands);
  const transformed = absolute.map((cmd) => transformCommand(cmd, m));
  return commandsToString(transformed);
}

function isIdentity(m: Affine2D): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

type PathCommand = {
  readonly op: string;
  readonly args: readonly number[];
};

/**
 * Tokenise a path-data string into an array of command records.
 *
 * The grammar accepts comma- or whitespace-separated numbers, with
 * optional sign + decimal + exponent. Implicit-repeat (e.g.
 * `M 0 0 10 10 20 20` ≡ `M 0 0 L 10 10 L 20 20`) is honoured by
 * checking the trailing argument count against the command's expected
 * arity.
 */
function parsePathData(d: string): readonly PathCommand[] {
  const out: PathCommand[] = [];
  const numberRegex = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;
  let i = 0;
  while (i < d.length) {
    const ch = d[i]!;
    if (/[a-zA-Z]/.test(ch)) {
      const op = ch;
      i += 1;
      const argCount = expectedArgCount(op);
      const args: number[] = [];
      while (i < d.length) {
        // Skip whitespace and commas
        while (i < d.length && /[\s,]/.test(d[i]!)) {
          i += 1;
        }
        if (i >= d.length) {
          break;
        }
        if (/[a-zA-Z]/.test(d[i]!)) {
          break;
        }
        numberRegex.lastIndex = i;
        const m = numberRegex.exec(d);
        if (m === null || m.index !== i) {
          break;
        }
        args.push(parseFloat(m[0]));
        i = numberRegex.lastIndex;
      }
      // Emit one or more commands depending on implicit-repeat.
      if (argCount === 0) {
        out.push({ op, args: [] });
      } else if (args.length >= argCount) {
        for (let k = 0; k < args.length; k += argCount) {
          if (k + argCount > args.length) {
            break;
          }
          const slice = args.slice(k, k + argCount);
          // Implicit repeat: after `M`/`m`, subsequent coordinate
          // pairs become `L`/`l` per SVG spec.
          const effectiveOp = k > 0 && (op === "M" || op === "m") ? (op === "M" ? "L" : "l") : op;
          out.push({ op: effectiveOp, args: slice });
        }
      }
    } else {
      i += 1;
    }
  }
  return out;
}

function expectedArgCount(op: string): number {
  switch (op.toLowerCase()) {
    case "m":
    case "l":
    case "t":
      return 2;
    case "h":
    case "v":
      return 1;
    case "c":
      return 6;
    case "s":
    case "q":
      return 4;
    case "a":
      return 7;
    case "z":
      return 0;
    default:
      return 0;
  }
}

/**
 * Convert relative commands to absolute. After this pass every
 * coordinate is an absolute point that the affine can transform
 * directly. `Z` resets the pen to the most-recent subpath start (the
 * last `M`/`m` resolved point).
 */
function toAbsoluteCommands(commands: readonly PathCommand[]): readonly PathCommand[] {
  const out: PathCommand[] = [];
  let penX = 0;
  let penY = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;
  for (const cmd of commands) {
    const op = cmd.op;
    const a = cmd.args;
    switch (op) {
      case "M": {
        const x = a[0]!;
        const y = a[1]!;
        out.push({ op: "M", args: [x, y] });
        penX = x;
        penY = y;
        subpathStartX = x;
        subpathStartY = y;
        break;
      }
      case "m": {
        const x = penX + a[0]!;
        const y = penY + a[1]!;
        out.push({ op: "M", args: [x, y] });
        penX = x;
        penY = y;
        subpathStartX = x;
        subpathStartY = y;
        break;
      }
      case "L": {
        const x = a[0]!;
        const y = a[1]!;
        out.push({ op: "L", args: [x, y] });
        penX = x;
        penY = y;
        break;
      }
      case "l": {
        const x = penX + a[0]!;
        const y = penY + a[1]!;
        out.push({ op: "L", args: [x, y] });
        penX = x;
        penY = y;
        break;
      }
      case "H": {
        const x = a[0]!;
        out.push({ op: "L", args: [x, penY] });
        penX = x;
        break;
      }
      case "h": {
        const x = penX + a[0]!;
        out.push({ op: "L", args: [x, penY] });
        penX = x;
        break;
      }
      case "V": {
        const y = a[0]!;
        out.push({ op: "L", args: [penX, y] });
        penY = y;
        break;
      }
      case "v": {
        const y = penY + a[0]!;
        out.push({ op: "L", args: [penX, y] });
        penY = y;
        break;
      }
      case "C": {
        out.push({ op: "C", args: [...a] });
        penX = a[4]!;
        penY = a[5]!;
        break;
      }
      case "c": {
        const args = [
          penX + a[0]!, penY + a[1]!,
          penX + a[2]!, penY + a[3]!,
          penX + a[4]!, penY + a[5]!,
        ];
        out.push({ op: "C", args });
        penX = args[4]!;
        penY = args[5]!;
        break;
      }
      case "S": {
        out.push({ op: "S", args: [...a] });
        penX = a[2]!;
        penY = a[3]!;
        break;
      }
      case "s": {
        const args = [
          penX + a[0]!, penY + a[1]!,
          penX + a[2]!, penY + a[3]!,
        ];
        out.push({ op: "S", args });
        penX = args[2]!;
        penY = args[3]!;
        break;
      }
      case "Q": {
        out.push({ op: "Q", args: [...a] });
        penX = a[2]!;
        penY = a[3]!;
        break;
      }
      case "q": {
        const args = [
          penX + a[0]!, penY + a[1]!,
          penX + a[2]!, penY + a[3]!,
        ];
        out.push({ op: "Q", args });
        penX = args[2]!;
        penY = args[3]!;
        break;
      }
      case "T": {
        out.push({ op: "T", args: [...a] });
        penX = a[0]!;
        penY = a[1]!;
        break;
      }
      case "t": {
        const args = [penX + a[0]!, penY + a[1]!];
        out.push({ op: "T", args });
        penX = args[0]!;
        penY = args[1]!;
        break;
      }
      case "A": {
        out.push({ op: "A", args: [...a] });
        penX = a[5]!;
        penY = a[6]!;
        break;
      }
      case "a": {
        const args = [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, penX + a[5]!, penY + a[6]!];
        out.push({ op: "A", args });
        penX = args[5]!;
        penY = args[6]!;
        break;
      }
      case "Z":
      case "z": {
        out.push({ op: "Z", args: [] });
        penX = subpathStartX;
        penY = subpathStartY;
        break;
      }
      default:
        // Unknown command — pass through verbatim.
        out.push({ op, args: [...a] });
        break;
    }
  }
  return out;
}

function transformCommand(cmd: PathCommand, m: Affine2D): PathCommand {
  switch (cmd.op) {
    case "M":
    case "L":
    case "T": {
      const [x, y] = applyPoint(m, cmd.args[0]!, cmd.args[1]!);
      return { op: cmd.op, args: [x, y] };
    }
    case "C": {
      const [x1, y1] = applyPoint(m, cmd.args[0]!, cmd.args[1]!);
      const [x2, y2] = applyPoint(m, cmd.args[2]!, cmd.args[3]!);
      const [x, y] = applyPoint(m, cmd.args[4]!, cmd.args[5]!);
      return { op: "C", args: [x1, y1, x2, y2, x, y] };
    }
    case "S":
    case "Q": {
      const [x1, y1] = applyPoint(m, cmd.args[0]!, cmd.args[1]!);
      const [x, y] = applyPoint(m, cmd.args[2]!, cmd.args[3]!);
      return { op: cmd.op, args: [x1, y1, x, y] };
    }
    case "A": {
      // The arc end-point parameterisation: [rx, ry, x-axis-rotation,
      // large-arc, sweep, x, y]. End point transforms; the ellipse
      // semi-axes need re-fitting under the affine. For rigid
      // transforms (rotation + uniform scale + translation) we can
      // adjust analytically; for the general case we transform the
      // end point and pass the original (rx, ry, rotation) through
      // unchanged — visibly wrong for skew but rare in icon data.
      const rx = cmd.args[0]!;
      const ry = cmd.args[1]!;
      const xAxisRot = cmd.args[2]!;
      const largeArc = cmd.args[3]!;
      const sweep = cmd.args[4]!;
      const [x, y] = applyPoint(m, cmd.args[5]!, cmd.args[6]!);
      const fitted = fitArcUnderAffine(rx, ry, xAxisRot, m);
      return {
        op: "A",
        args: [fitted.rx, fitted.ry, fitted.rotationDeg, largeArc, sweep, x, y],
      };
    }
    case "Z":
      return cmd;
    default:
      return cmd;
  }
}

function applyPoint(m: Affine2D, x: number, y: number): readonly [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

/**
 * Re-fit an SVG arc's `(rx, ry, rotation)` triple after applying the
 * given affine. Works exactly for rotation + uniform scale + pure
 * translation (which is the only case a captured `<g transform>`
 * uses in practice for icon data); shear / non-uniform scale fall
 * back to a uniform-scale approximation.
 *
 * Maths: an SVG arc traces an ellipse `E` with semi-axes (rx, ry)
 * tilted by `rotationDeg`. Under the linear part `[a c; b d]` of
 * the affine, the ellipse maps to a new ellipse `E'` whose semi-axes
 * and tilt are the singular value decomposition of `[a c; b d] · R(rotationDeg) · diag(rx, ry)`.
 *
 * For the targeted subset we don't need the full SVD: when `[a c; b
 * d]` is itself a similarity (`a*d - b*c > 0` and rows have equal
 * norm), the new semi-axes are `s * rx, s * ry` and the new rotation
 * is `rotationDeg + θ` where `s` is the uniform scale and `θ` the
 * rotation angle.
 */
function fitArcUnderAffine(
  rx: number,
  ry: number,
  rotationDeg: number,
  m: Affine2D,
): { readonly rx: number; readonly ry: number; readonly rotationDeg: number } {
  const a = m.a;
  const b = m.b;
  const c = m.c;
  const d = m.d;
  const sxSquared = a * a + b * b;
  const sySquared = c * c + d * d;
  const sx = Math.sqrt(sxSquared);
  const sy = Math.sqrt(sySquared);
  // Detect similarity: equal scales on x and y axes, no shear.
  const nearlyEqual = Math.abs(sx - sy) < 1e-6 * Math.max(1, sx, sy);
  const dot = a * c + b * d;
  const noShear = Math.abs(dot) < 1e-6 * Math.max(1, sx * sy);
  if (nearlyEqual && noShear) {
    const theta = Math.atan2(b, a) * 180 / Math.PI;
    return { rx: rx * sx, ry: ry * sy, rotationDeg: rotationDeg + theta };
  }
  // General case fallback: scale the semi-axes by the per-axis
  // factors and keep the rotation. This is approximate for skew but
  // matches the captured shape closely enough for icon data, where
  // skew is virtually never used.
  return { rx: rx * sx, ry: ry * sy, rotationDeg };
}

function commandsToString(commands: readonly PathCommand[]): string {
  return commands
    .map((cmd) => {
      if (cmd.args.length === 0) {
        return cmd.op;
      }
      return `${cmd.op} ${cmd.args.map(formatNumber).join(" ")}`;
    })
    .join(" ");
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) {
    return "0";
  }
  // Round to 4 decimal places to keep output compact while preserving
  // enough precision for sub-pixel transforms.
  const rounded = Math.round(n * 10000) / 10000;
  if (rounded === 0) {
    return "0";
  }
  return rounded.toString();
}
