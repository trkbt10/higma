/**
 * @file Per-case roundtrip runner. Drives one fig fixture end-to-end:
 *
 *   .fig → fig-to-godot emit → Godot headless render → actual.png
 *                                                    ↓
 *   reference.png (rendered from the same .fig by the WebGL harness
 *   shipped with @higma-tools/fig-to-swiftui)
 *                                                    ↓
 *   pixelmatch → diff.png + diffPercent → assert ≤ per-frame cap
 *
 * Each per-case spec file (e.g. `cases/autolayout/render.spec.ts`)
 * imports `runRoundtripCase` and supplies:
 *
 *   - `caseName`: the fixture directory name under
 *     `@higma-document-renderers/fig/fixtures/<caseName>/`.
 *   - `canvasName`: the Figma page that contains the top-level frames.
 *   - `frameNames`: the v0-supported frame names (a subset of the
 *     fixture; advanced cases not yet emit-supported are deferred).
 *   - `diffCapPct`: per-frame override map; falls back to default.
 *
 * Reference PNGs are byte-identical copies of the swiftui peer's
 * `@higma-tools/fig-to-swiftui/cases/<caseName>/<frame>/reference.png`.
 * The cross-tool boundary forbids importing the swiftui peer at
 * runtime, so the bytes are copied into this package's own
 * `cases/<caseName>/<frame>/reference.png` tree at fixture-prep time.
 *
 * `actual.png` + `diff.png` get written next to every `reference.png`
 * on every run so a failing diff has an inspectable artifact pair on
 * disk without re-running the test.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { comparePng } from "@higma-codecs/png-compare";
import { createFigSymbolContext, findCanvas } from "@higma-document-io/fig/context";
import {
  buildFrameScene,
  buildFrameTarget,
  emitFrameFile,
  listFrameTargets,
  type EmitContext,
} from "@higma-tools/fig-to-godot/emit";
import {
  parseScene,
  serializeScene,
  type GodotNode,
  type GodotProperty,
  type GodotScene,
  type GodotSubResource,
  type GodotValue,
} from "@higma-tools/fig-to-godot/godot-tree";
import { isGodotAvailable, renderGodotBatch } from "@higma-tools/fig-to-godot/render";

/** PNG magic so we can floor-check the renderer actually produced an image. */
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Default cap on per-frame pixel diff vs WebGL reference, in percent. */
const DEFAULT_DIFF_CAP_PCT = 1;

/** pixelmatch per-pixel sensitivity (0=strict … 1=lax). */
/**
 * pixelmatch per-pixel sensitivity (0=strict … 1=lax).
 *
 * 0.0 means "any byte difference counts as a diff pixel" — the
 * tightest setting. Achievable now that the byte-rounding
 * compensation in `colorExpr` makes Godot's truncate-by-256 produce
 * the same byte WebGL renders for every fig channel value. Setting
 * it higher would let real regressions slip through as "AA noise".
 */
const PIXELMATCH_THRESHOLD = 0.0;

/**
 * Where the canonical fig fixtures live. Same SoT the swiftui peer
 * resolves via `@higma-tools/fig-to-swiftui/spec/cases/fixture-source`
 * — kept here as a constant rather than reaching across the
 * tools-scope boundary.
 */
const FIXTURES_ROOT_FROM_THIS_FILE = "../../../../@higma-document-renderers/fig/fixtures";

export type RunRoundtripCaseOptions = {
  /** Fixture dir name (e.g. "autolayout", "rectangle"). */
  readonly caseName: string;
  /** Figma page name containing the top-level frames to render. */
  readonly canvasName: string;
  /**
   * Frame names to verify. Frames present in the fixture but missing
   * from this list are skipped — typically because they exercise a
   * fig feature the v0 emitter does not yet model.
   */
  readonly frameNames: readonly string[];
  /** Per-frame diff cap override (in percent). */
  readonly diffCapPct?: Readonly<Record<string, number>>;
};

/**
 * Wire up the structural + pixel-diff describe blocks for one case.
 * Call from a per-case spec file's top level.
 */
export async function runRoundtripCase(options: RunRoundtripCaseOptions): Promise<void> {
  const figPath = resolveFixturePath(options.caseName);
  const bytes = new Uint8Array(await readFile(figPath));
  const ctx = await createFigSymbolContext(bytes);
  const canvas = findCanvas(ctx, options.canvasName);
  if (!canvas) {
    throw new Error(
      `runRoundtripCase: fixture "${options.caseName}" missing canvas "${options.canvasName}"`,
    );
  }
  const allFrames = listFrameTargets(canvas);
  const wanted = new Set(options.frameNames);
  const frames = allFrames.filter((f) => f.name !== undefined && wanted.has(f.name));
  if (frames.length === 0) {
    throw new Error(
      `runRoundtripCase: fixture "${options.caseName}" has no v0-supported top-level frames matching ${[...wanted].join(", ")}`,
    );
  }

  const sceneNamesUsed = new Set<string>();
  const slugsUsed = new Set<string>();
  const targets = frames.map((node) =>
    buildFrameTarget(node, { outputDir: "Pages", sceneNamesUsed, slugsUsed }),
  );
  // Doc-level lookups passed to the emit walker. Carrying `symbolMap`
  // here is what lets INSTANCE nodes resolve to their authoring
  // SYMBOL — without it, frames built from instances (e.g. the
  // `constraints` fixture) emit as empty Controls. `images` lets
  // IMAGE paints resolve to their actual PNG/JPEG bytes — required
  // for the `image-fill` fixtures.
  const emitCtx: EmitContext = {
    symbolMap: ctx.symbolMap,
    blobs: ctx.blobs,
    images: ctx.images,
  };
  const sized = targets.map((target, idx) => {
    const node = frames[idx]!;
    const size = node.size ?? { x: 200, y: 200 };
    return {
      target,
      figmaName: node.name ?? "",
      width: Math.max(1, Math.round(size.x)),
      height: Math.max(1, Math.round(size.y)),
    };
  });

  describe(`structural roundtrip — ${options.caseName} fixture`, () => {
    it.each(sized.map(({ target }) => ({ target })))(
      "$target.sceneName — serialize → parse round-trips to the same IR",
      ({ target }) => {
        const original = buildFrameScene(target, emitCtx);
        const expected = {
          ...original,
          root: { ...original.root, name: target.sceneName },
        };
        const text = serializeScene(expected);
        const parsed = parseScene(text);
        expect(normalizeScene(parsed)).toEqual(normalizeScene(expected));
      },
    );

    it("produces non-empty .tscn text for every frame", () => {
      for (const { target } of sized) {
        const file = emitFrameFile(target, emitCtx);
        expect(file.contents).toContain("[gd_scene");
        expect(file.contents.length).toBeGreaterThan(50);
      }
    });
  });

  const godotAvailable = await isGodotAvailable();
  // Render every frame in one Godot batch up front, then each `it`
  // just looks up its PNG by index. The previous one-process-per-frame
  // pattern OOM'd at ~150 frames under vitest's parallel pool — batch
  // renders share a single Godot process per spec file, holding total
  // memory flat regardless of frame count.
  const batchPngs = godotAvailable ? await batchRender(sized, emitCtx) : undefined;

  (godotAvailable ? describe : describe.skip)(
    `pixel diff — ${options.caseName} fixture (Godot vs WebGL reference)`,
    () => {
      it.each(sized.map((s, i) => ({ ...s, _i: i })))(
        "$figmaName — Godot render diffs ≤ cap against fig WebGL reference",
        async ({ figmaName, width, height, _i }) => {
          const png = batchPngs![_i]!;
          // Sanity floor: result is a real PNG with the requested size.
          expect(png.length).toBeGreaterThan(PNG_SIGNATURE.length);
          expect(Array.from(png.slice(0, 8))).toEqual(Array.from(PNG_SIGNATURE));

          const refPath = resolveReferencePath(options.caseName, figmaName);
          const expectedPng = new Uint8Array(await readFile(refPath));
          const outcome = comparePng(png, expectedPng, { threshold: PIXELMATCH_THRESHOLD });

          // Always write the actual + diff next to the reference so a
          // failing run leaves an inspectable artifact pair on disk.
          const outDir = dirname(refPath);
          await mkdir(outDir, { recursive: true });
          await writeFile(`${outDir}/actual.png`, png);
          if (outcome.kind === "compared") {
            await writeFile(`${outDir}/diff.png`, outcome.diffPng);
          }

          if (outcome.kind === "mismatched-dimensions") {
            throw new Error(
              `${figmaName}: dimensions mismatch — actual ${outcome.actual.width}x${outcome.actual.height}, expected ${outcome.expected.width}x${outcome.expected.height} (requested ${width}x${height})`,
            );
          }
          const cap = options.diffCapPct?.[figmaName] ?? DEFAULT_DIFF_CAP_PCT;
          if (outcome.diffPercent > cap) {
            throw new Error(
              `${figmaName}: diff ${outcome.diffPercent.toFixed(2)}% exceeds cap ${cap}% (diffPixels=${outcome.diffPixels})`,
            );
          }
        },
        90_000,
      );
    },
  );
}

/**
 * Resolve `<repoRoot>/packages/@higma-document-renderers/fig/fixtures/<caseName>/<caseName>.fig`
 * relative to this file. Falls back to the first `.fig` file in the
 * directory when the canonical name does not exist (matches the
 * swiftui peer's `resolveFixturePath` behaviour).
 */
function resolveFixturePath(caseName: string): string {
  const here = new URL(".", import.meta.url).pathname;
  return fileURLToPath(new URL(`${FIXTURES_ROOT_FROM_THIS_FILE}/${caseName}/${caseName}.fig`, `file://${here}`));
}

/**
 * Resolve `<package>/cases/<caseName>/<figmaName>/reference.png`
 * relative to this file.
 */
function resolveReferencePath(caseName: string, figmaName: string): string {
  return fileURLToPath(new URL(`../../cases/${caseName}/${figmaName}/reference.png`, import.meta.url));
}

/**
 * Strip lossy-by-design fields before comparing IRs.
 *
 * `enum` values lose their symbolic `name` field on serialize → parse
 * because Godot's `.tscn` only stores the integer; the parser maps
 * `enum` back to `int`. Normalise the original to `int` so the compare
 * doesn't see a spurious diff.
 */
function normalizeScene(sceneDoc: GodotScene): GodotScene {
  return {
    extResources: sceneDoc.extResources,
    subResources: sceneDoc.subResources.map(normalizeSubResource),
    root: normalizeNode(sceneDoc.root),
  };
}

function normalizeSubResource(sub: GodotSubResource): GodotSubResource {
  return { ...sub, properties: sub.properties.map(normalizeProperty) };
}

function normalizeNode(node: GodotNode): GodotNode {
  return {
    ...node,
    properties: node.properties.map(normalizeProperty),
    children: node.children.map(normalizeNode),
  };
}

function normalizeProperty(prop: GodotProperty): GodotProperty {
  return { name: prop.name, value: normalizeValue(prop.value) };
}

/** Drive `renderGodotBatch` for the spec's resolved frame list. */
async function batchRender(
  sized: readonly { target: ReturnType<typeof buildFrameTarget>; width: number; height: number }[],
  emitCtx: EmitContext,
): Promise<readonly Uint8Array[]> {
  const entries = sized.map(({ target, width, height }) => {
    const file = emitFrameFile(target, emitCtx);
    return {
      sceneText: file.contents,
      companions: file.assets,
      width,
      height,
    };
  });
  const result = await renderGodotBatch(entries);
  return result.pngs;
}

function normalizeValue(value: GodotValue): GodotValue {
  if (value.kind === "enum") {
    return { kind: "int", value: roundFloatPrecision(value.value) };
  }
  if (value.kind === "float") {
    return { kind: "float", value: roundFloatPrecision(value.value) };
  }
  if (value.kind === "color") {
    return {
      kind: "color",
      r: roundFloatPrecision(value.r),
      g: roundFloatPrecision(value.g),
      b: roundFloatPrecision(value.b),
      a: roundFloatPrecision(value.a),
    };
  }
  if (value.kind === "vector2") {
    return { kind: "vector2", x: roundFloatPrecision(value.x), y: roundFloatPrecision(value.y) };
  }
  if (value.kind === "rect2") {
    return {
      kind: "rect2",
      x: roundFloatPrecision(value.x),
      y: roundFloatPrecision(value.y),
      w: roundFloatPrecision(value.w),
      h: roundFloatPrecision(value.h),
    };
  }
  return value;
}

/**
 * Mirror the serializer's `toFixed(6)` + trailing-zero trim so the
 * structural roundtrip compare doesn't trip on float32-precision
 * artifacts the kiwi decode introduces (`0.1` vs `0.10000000149011612`).
 * The serialized text is the SoT for what the parser can recover.
 */
function roundFloatPrecision(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  return Number(value.toFixed(6));
}
