/**
 * @file Format a resolved TextRendering to SVG.
 *
 * This is the single SVG-specific transducer from the shared `TextRendering`
 * SoT (src/text/rendering) to SvgString. Direct-SVG and scene-graph SVG
 * paths both funnel through here.
 */

import type { TextRendering, TextRenderingGlyphs } from "../../../text/rendering";
import type { PathContour } from "../../../text/paths/types";
import type { RenderTextGlyphRun } from "../../../scene-graph";
import { path as svgPath, text, g, type SvgString, EMPTY_SVG } from "../../primitives";
import { buildTransformAttr } from "../../transform";
import { buildTextAttrs } from "./attrs";

/** Default floating-point precision for path coordinate emission. */
const PATH_PRECISION = 5;

function roundTo(n: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(n * factor) / factor;
}

/** Serialize a set of contours to a single SVG `d` string. */
function contoursToPathD(contours: readonly PathContour[], precision: number): string {
  const r = (n: number | undefined): string => roundTo(n ?? 0, precision).toString();
  const parts: string[] = [];
  for (const c of contours) {
    for (const cmd of c.commands) {
      switch (cmd.type) {
        case "M":
          parts.push(`M${r(cmd.x)} ${r(cmd.y)}`);
          break;
        case "L":
          parts.push(`L${r(cmd.x)} ${r(cmd.y)}`);
          break;
        case "C":
          parts.push(`C${r(cmd.x1)} ${r(cmd.y1)} ${r(cmd.x2)} ${r(cmd.y2)} ${r(cmd.x)} ${r(cmd.y)}`);
          break;
        case "Q":
          parts.push(`Q${r(cmd.x1)} ${r(cmd.y1)} ${r(cmd.x)} ${r(cmd.y)}`);
          break;
        case "Z":
          parts.push("Z");
          break;
      }
    }
  }
  return parts.join("");
}

/**
 * Build per-run path-data segments for glyph mode.
 *
 * Each `TextRun` lists a `[start, end)` source-character range and the
 * resolved `fillColor`/`fillOpacity`. Glyph contours carry a
 * `firstCharacter` annotation (from `derivedTextData.glyphs[].firstCharacter`)
 * that we use to bucket each contour into the run that owns its source
 * character. Decorations have no character index and always paint with
 * the base (first) run.
 */
function buildPerRunPathData(rendering: TextRenderingGlyphs, precision: number): readonly RenderTextGlyphRun[] {
  const runs = rendering.runs;
  if (runs.length === 0) { return []; }

  function runIndexForChar(i: number): number {
    for (let r = 0; r < runs.length; r++) {
      if (i >= runs[r].start && i < runs[r].end) { return r; }
    }
    return -1;
  }

  const buckets = new Map<number, PathContour[]>();
  for (const c of rendering.glyphContours) {
    const ci = c.firstCharacter;
    const idx = ci === undefined ? -1 : runIndexForChar(ci);
    const key = idx >= 0 ? idx : 0;
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }
  const baseList = buckets.get(0) ?? [];
  for (const dec of rendering.decorationContours) {
    baseList.push(dec);
  }
  if (baseList.length > 0) { buckets.set(0, baseList); }

  const out: RenderTextGlyphRun[] = [];
  for (let r = 0; r < runs.length; r++) {
    const list = buckets.get(r);
    if (!list || list.length === 0) { continue; }
    out.push({
      fillColor: runs[r].fillColor,
      fillOpacity: runs[r].fillOpacity,
      d: contoursToPathD(list, precision),
    });
  }
  return out;
}

/** Wrap rendered text body in a group when transform/opacity is present. */
function wrapGroup(body: SvgString, transform: string | undefined, opacity: number): SvgString {
  if (!transform && opacity >= 1) {
    return body;
  }
  return g(
    {
      transform: transform || undefined,
      opacity: opacity < 1 ? opacity : undefined,
    },
    body,
  );
}

/**
 * Format a resolved `TextRendering` into a backend-agnostic SvgString.
 *
 * - `empty`  → EMPTY_SVG (no output)
 * - `glyphs` → combined `<path>` with all glyph + decoration contours
 * - `lines`  → one or more `<text>` elements per line, via `buildTextAttrs`
 */
export function formatTextRenderingToSvg(rendering: TextRendering): SvgString {
  if (rendering.kind === "empty") {
    return EMPTY_SVG;
  }

  const transformStr = buildTransformAttr(rendering.transform);

  if (rendering.kind === "glyphs") {
    // Group glyph contours by TextRun. Decorations always paint with the
    // base run's fill (Figma applies them at the line level, not per
    // character). Glyphs without `firstCharacter` (e.g. opentype synthesised
    // line contours, Figma ellipsis glyph) are folded into the base run.
    const runs = rendering.runs;
    const runPaths = runs.length > 0 ? buildPerRunPathData(rendering, PATH_PRECISION) : [];
    const totalCommands = runPaths.reduce((acc, r) => acc + r.d.length, 0);
    if (totalCommands === 0) {
      if (rendering.props.characters.trim().length > 0) {
        throw new Error("SVG text renderer received glyph rendering with no visible contours for non-empty text");
      }
      return EMPTY_SVG;
    }
    const elements: SvgString[] = runPaths.map((r) => svgPath({
      d: r.d,
      fill: r.fillColor,
      "fill-opacity": r.fillOpacity < 1 ? r.fillOpacity : undefined,
    }));
    const body: SvgString = elements.length === 1 ? elements[0] : g({}, ...elements);
    return wrapGroup(body, transformStr, rendering.opacity);
  }

  // kind === "lines"
  const { layout, props, fillColor, fillOpacity } = rendering;
  if (layout.lines.length === 0) {
    if (props.characters.trim().length > 0) {
      throw new Error("SVG text renderer received line rendering with no lines for non-empty text");
    }
    return EMPTY_SVG;
  }

  const textAttrs = buildTextAttrs({
    props,
    fillColor,
    fillOpacity,
  });

  if (layout.lines.length === 1) {
    const line = layout.lines[0];
    const el = text({ ...textAttrs, x: line.x, y: line.y }, line.text);
    return wrapGroup(el, transformStr, rendering.opacity);
  }

  const els: SvgString[] = layout.lines.map((line) =>
    text({ ...textAttrs, x: line.x, y: line.y }, line.text),
  );
  return wrapGroup(g({}, ...els), transformStr, rendering.opacity);
}
