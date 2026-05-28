/**
 * @file Shared visual-binding utilities for `.fig`-fixture regression specs.
 *
 * Loads a fixture's `.fig`, renders each top-level layer through the
 * SVG renderer, rasterises both the renderer output and the Figma-
 * exported `actual/<layer>.svg`, and reports per-layer pixel diffs.
 *
 * Single-source-of-truth references:
 *
 *   - Pixel comparison: `comparePng` from `@higma-codecs/png-compare`
 *     (the project's SoT for diff arithmetic; refuses to silently
 *     resize on dimension mismatches).
 *   - Fig parsing: `createFigDocumentContext` from
 *     `@higma-document-io/fig` (the canonical entry point — same path
 *     `scripts/generate-snapshots.ts` and `run-case.ts` in
 *     `@higma-tools/fig-to-godot` use).
 *   - Canvas / child lookup: `findCanvases` and `resources.childrenOf`
 *     from the same module.
 *
 * This module owns only the SVG→PNG rasterisation and the per-layer
 * dispatch around those primitives.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { comparePng } from "@higma-codecs/png-compare";
import {
  createFigDocumentContext,
  figDocumentResources,
  findCanvases,
  type FigDocumentContext,
} from "@higma-document-io/fig";
import type { FigBlob } from "@higma-document-models/fig/domain";
import type { FigPackageImage } from "@higma-figma-containers/package";
import type { FigNode } from "@higma-document-models/fig/types";
import { renderFigToSvg } from "../../src/svg/renderer";

/** Per-layer metadata threaded from fixture parse into the renderer call. */
export type LayerInfo = {
  readonly name: string;
  readonly node: FigNode;
  readonly size: { readonly width: number; readonly height: number };
};

/** Parsed-and-indexed fixture handed to `compareFixtureLayers`. */
export type ParsedFigFixture = {
  readonly context: FigDocumentContext;
  readonly canvases: readonly FigNode[];
  readonly layers: ReadonlyMap<string, LayerInfo>;
  readonly blobs: readonly FigBlob[];
  readonly images: ReadonlyMap<string, FigPackageImage>;
};

/**
 * Load a `.fig` file via the canonical `createFigDocumentContext`
 * pipeline and index every top-level layer (the direct children of
 * every `CANVAS` page) by name. The returned `context` carries the
 * `symbolResolver`, `styleRegistry`, and child-lookup tables that
 * `renderCanvas` needs to resolve `INSTANCE` references against the
 * authoring `SYMBOL` definitions.
 */
export async function loadFigFixture(figFilePath: string): Promise<ParsedFigFixture> {
  if (!fs.existsSync(figFilePath)) {
    throw new Error(`Fixture file not found: ${figFilePath}`);
  }
  const buffer = new Uint8Array(fs.readFileSync(figFilePath));
  const context = await createFigDocumentContext(buffer);
  const resources = figDocumentResources(context);
  const canvases = findCanvases(resources.document);
  const layers = new Map<string, LayerInfo>();
  for (const canvas of canvases) {
    for (const child of resources.childrenOf(canvas)) {
      const name = child.name ?? "unnamed";
      const size = child.size;
      layers.set(name, {
        name,
        node: child,
        size: { width: size?.x ?? 100, height: size?.y ?? 100 },
      });
    }
  }
  return { context, canvases, layers, blobs: resources.blobs, images: resources.images };
}

/**
 * Rasterise an SVG to a PNG byte buffer. Uses resvg with system-font
 * loading enabled and `shapeRendering`/`textRendering` set to the
 * highest-fidelity modes (`2`), matching the opts Figma's own SVG
 * exporter is closest to. When `width` is supplied the SVG is
 * fitted to that pixel width so the comparison happens at a
 * predictable resolution; omit `width` to render at the SVG's
 * intrinsic size.
 */
export function svgToPng(svg: string, width?: number): Uint8Array {
  const opts: {
    fitTo?: { mode: "width"; value: number };
    font?: { loadSystemFonts: boolean };
    shapeRendering?: 0 | 1 | 2;
    textRendering?: 0 | 1 | 2;
  } = {
    font: { loadSystemFonts: true },
    shapeRendering: 2,
    textRendering: 2,
  };
  if (width !== undefined) {
    opts.fitTo = { mode: "width", value: width };
  }
  const resvg = new Resvg(svg, opts);
  const png = resvg.render().asPng();
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}

/** Per-layer comparison outcome reported by `compareFixtureLayers`. */
export type LayerCompareOutcome =
  | {
      readonly kind: "compared";
      readonly layerName: string;
      readonly diffPercent: number;
      readonly diffPixels: number;
      readonly width: number;
      readonly height: number;
    }
  | { readonly kind: "no-baseline"; readonly layerName: string }
  | {
      readonly kind: "dimension-mismatch";
      readonly layerName: string;
      readonly actual: { readonly width: number; readonly height: number };
      readonly expected: { readonly width: number; readonly height: number };
    };

/** Resolved fixture directory layout. Use `fixturePaths` to construct. */
export type FixtureBindingPaths = {
  readonly figFile: string;
  readonly actualDir: string;
  readonly snapshotsDir: string;
  readonly outputDir: string;
  readonly diffDir: string;
};

/** Resolve the four sibling directories used by a fixture-bound spec. */
export function fixturePaths(fixtureRoot: string, figFileName: string): FixtureBindingPaths {
  return {
    figFile: path.join(fixtureRoot, figFileName),
    actualDir: path.join(fixtureRoot, "actual"),
    snapshotsDir: path.join(fixtureRoot, "snapshots"),
    outputDir: path.join(fixtureRoot, "__output__"),
    diffDir: path.join(fixtureRoot, "__diff__"),
  };
}

/** Create the listed directories if absent (idempotent). */
export function ensureDirs(dirs: readonly string[]): void {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, "_");
}

/**
 * List the `.svg` baseline files already exported from Figma into the
 * fixture's `actual/` directory. Returns an empty set when the
 * directory does not exist yet (e.g. a freshly-generated `.fig` that
 * has not been round-tripped through Figma).
 */
function listActualSvgs(actualDir: string): ReadonlySet<string> {
  if (!fs.existsSync(actualDir)) {
    return new Set();
  }
  return new Set(fs.readdirSync(actualDir).filter((f) => f.endsWith(".svg")));
}

/** Options for `compareFixtureLayers`. */
export type CompareLayerOptions = {
  /** Anti-aliasing exclusion; default `true` (exclude AA from diff). */
  readonly excludeAA?: boolean;
  /** pixelmatch threshold in [0,1]; default 0.1. */
  readonly threshold?: number;
};

/**
 * Read PNG width from the IHDR chunk. PNG files start with the 8-byte
 * signature followed by the IHDR chunk; bytes 16..19 are the width
 * as a big-endian uint32. Faster and dep-free compared to a full
 * parse when only the width is needed.
 */
function readPngWidth(png: Uint8Array): number {
  return (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
}

/**
 * Build the viewport descriptor for a single-layer render.
 * Derives the layer's canvas-space origin from its transform's
 * translation components so the renderer crops to the layer's
 * own bounding box rather than the whole page.
 */
function viewportForLayer(layer: LayerInfo): { x: number; y: number; width: number; height: number } {
  const transform = layer.node.transform;
  return {
    x: transform?.m02 ?? 0,
    y: transform?.m12 ?? 0,
    width: layer.size.width,
    height: layer.size.height,
  };
}

/**
 * Render one layer through the SVG renderer using the same single-
 * element shape `scripts/generate-snapshots.ts` uses (`renderFigToSvg`
 * with the layer as a one-element array plus a viewport derived from
 * the layer's transform). Threads the full `FigDocumentContext`
 * resources so `INSTANCE` and style references resolve against their
 * authoring nodes.
 */
async function renderLayer(fixture: ParsedFigFixture, layer: LayerInfo): Promise<string> {
  const resources = figDocumentResources(fixture.context);
  const rendered = await renderFigToSvg([layer.node], {
    width: layer.size.width,
    height: layer.size.height,
    viewport: viewportForLayer(layer),
    sourceDocumentReference: resources.document,
    sourceRevision: 0,
    blobs: resources.blobs,
    images: resources.images,
    childrenOf: resources.childrenOf,
    symbolResolver: resources.symbolResolver,
    styleRegistry: resources.styleRegistry,
  });
  return rendered.svg;
}

/**
 * Compare one rendered layer SVG against its Figma-exported baseline.
 * Writes the rasterised PNGs (and the diff PNG, when non-zero) to
 * `paths.outputDir` / `paths.diffDir` so a failing run leaves an
 * inspectable artifact pair on disk without re-running the test.
 *
 * When the baseline does not exist the call returns `no-baseline`
 * without invoking `comparePng` — the caller decides whether that is
 * a soft skip (round-trip not yet performed) or a hard failure.
 */
async function compareOneLayer(
  fixture: ParsedFigFixture,
  layer: LayerInfo,
  paths: FixtureBindingPaths,
  actualSvgs: ReadonlySet<string>,
  threshold: number,
  excludeAA: boolean,
): Promise<LayerCompareOutcome> {
  const renderedSvg = await renderLayer(fixture, layer);
  const safe = safeFileName(layer.name);
  fs.writeFileSync(path.join(paths.snapshotsDir, `${safe}.svg`), renderedSvg);

  const actualFile = `${layer.name}.svg`;
  if (!actualSvgs.has(actualFile)) {
    return { kind: "no-baseline", layerName: layer.name };
  }

  const actualSvg = fs.readFileSync(path.join(paths.actualDir, actualFile), "utf-8");
  const actualPng = svgToPng(actualSvg);
  const renderedPng = svgToPng(renderedSvg, readPngWidth(actualPng));

  fs.writeFileSync(path.join(paths.outputDir, `${safe}-actual.png`), actualPng);
  fs.writeFileSync(path.join(paths.outputDir, `${safe}-rendered.png`), renderedPng);

  const result = comparePng(renderedPng, actualPng, { threshold, includeAA: !excludeAA });
  if (result.kind === "mismatched-dimensions") {
    return {
      kind: "dimension-mismatch",
      layerName: layer.name,
      actual: result.actual,
      expected: result.expected,
    };
  }
  if (result.diffPixels > 0) {
    fs.writeFileSync(path.join(paths.diffDir, `${safe}-diff.png`), Buffer.from(result.diffPng));
  }
  return {
    kind: "compared",
    layerName: layer.name,
    diffPercent: result.diffPercent,
    diffPixels: result.diffPixels,
    width: result.width,
    height: result.height,
  };
}

/**
 * Render every layer in the fixture, rasterise to PNG at the
 * baseline's pixel width, and compare via `comparePng`. Layers with
 * no corresponding `actual/<name>.svg` report `kind: "no-baseline"`;
 * dimension mismatches surface as `kind: "dimension-mismatch"`.
 */
export async function compareFixtureLayers(
  fixture: ParsedFigFixture,
  paths: FixtureBindingPaths,
  options: CompareLayerOptions = {},
): Promise<readonly LayerCompareOutcome[]> {
  const excludeAA = options.excludeAA ?? true;
  const threshold = options.threshold ?? 0.1;
  const actualSvgs = listActualSvgs(paths.actualDir);
  const outcomes: LayerCompareOutcome[] = [];
  for (const [, layer] of fixture.layers) {
    outcomes.push(await compareOneLayer(fixture, layer, paths, actualSvgs, threshold, excludeAA));
  }
  return outcomes;
}

/** Options for `describeFixtureVisualBinding`. */
export type FixtureVisualBindingOptions = {
  /**
   * Display label for the describe block; typically the fixture
   * directory name (e.g. `"rectangle"`, `"shapes"`, `"image-fill"`).
   */
  readonly id: string;
  /** Fixture directory (the one that contains the `.fig` + `actual/`). */
  readonly fixtureRoot: string;
  /** `.fig` filename within `fixtureRoot`. */
  readonly figFileName: string;
  /**
   * Per-layer diff cap (percent of pixels). Exceeding this on any
   * layer fails the assertion. A `0` cap means "must be byte-identical
   * after AA exclusion".
   */
  readonly maxDiffPercent: number;
  /**
   * Per-layer overrides for the cap. Use sparingly — the layers
   * listed here are known to carry renderer-vs-Figma divergence the
   * fixture-binding spec is not the right place to fix. Each entry
   * should be accompanied by a comment at the call site explaining
   * the divergence and the follow-up that would let it drop back to
   * `maxDiffPercent`.
   */
  readonly perLayerOverrides?: Readonly<Record<string, number>>;
};

function statusLabel(outcome: LayerCompareOutcome, cap: number): "PASS" | "FAIL" | "SKIP" {
  if (outcome.kind === "no-baseline") {
    return "SKIP";
  }
  if (outcome.kind === "dimension-mismatch") {
    return "FAIL";
  }
  if (outcome.diffPercent > cap) {
    return "FAIL";
  }
  return "PASS";
}

function summariseOutcome(outcome: LayerCompareOutcome): string {
  if (outcome.kind === "compared") {
    return `${outcome.layerName}: ${outcome.diffPercent.toFixed(2)}% (${outcome.diffPixels}px @ ${outcome.width}×${outcome.height})`;
  }
  if (outcome.kind === "no-baseline") {
    return `${outcome.layerName}: NO BASELINE — export from Figma to ${path.join("fixtures", outcome.layerName)}.svg`;
  }
  return `${outcome.layerName}: DIMENSION MISMATCH actual=${outcome.actual.width}×${outcome.actual.height} expected=${outcome.expected.width}×${outcome.expected.height}`;
}

/**
 * Register a Vitest `describe` block that pixel-binds every layer in
 * the fixture against its Figma-exported baseline under
 * `actual/<layer>.svg`. Designed to be called from inside an existing
 * per-fixture spec file (`rectangle.spec.ts`, `shapes.spec.ts`,
 * `image-fill.spec.ts`, …) — extending those specs with a visual
 * binding tier rather than introducing a parallel spec file.
 *
 * Layers with no baseline (e.g. fixtures regenerated since the last
 * Figma round-trip) are reported as `SKIP` and do not fail the
 * assertion — Figma round-tripping is a manual step. Dimension
 * mismatches DO fail loudly: the comparison primitive in
 * `@higma-codecs/png-compare` refuses to silently resize, on the
 * principle that "what dimensions did each pipeline produce" is
 * information not noise.
 */
export function describeFixtureVisualBinding(options: FixtureVisualBindingOptions): void {
  const paths = fixturePaths(options.fixtureRoot, options.figFileName);
  describe(`${options.id} — visual binding vs Figma actuals`, () => {
    it(`every layer ≤ cap (${options.maxDiffPercent.toFixed(1)}% default)`, { timeout: 120_000 }, async () => {
      ensureDirs([paths.snapshotsDir, paths.outputDir, paths.diffDir]);
      const fixture = await loadFigFixture(paths.figFile);
      const outcomes = await compareFixtureLayers(fixture, paths, { excludeAA: true });

      const capFor = (layerName: string): number => options.perLayerOverrides?.[layerName] ?? options.maxDiffPercent;
      const failures = outcomes.filter((o) => statusLabel(o, capFor(o.layerName)) === "FAIL");

      console.log(`\n=== ${options.id} ===`);
      for (const o of outcomes) {
        console.log(`  [${statusLabel(o, capFor(o.layerName))}] ${summariseOutcome(o)}`);
      }

      expect(failures, failures.map(summariseOutcome).join("\n")).toHaveLength(0);
    });
  });
}
