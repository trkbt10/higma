/**
 * @file End-to-end roundtrip verification for fig-to-godot.
 *
 * Two layers of verification, run together so a single test invocation
 * covers both:
 *
 *   1. **Structural** — emit `.tscn` text from the fig fixture, parse
 *      it back into the typed IR, compare to the IR produced directly
 *      by `buildFrameScene`. Proves the serializer + parser are
 *      inverse operations and that `.tscn` text is the only artifact
 *      crossing the IR boundary.
 *
 *   2. **PNG (gated)** — when Godot is callable on this machine, hand
 *      the emitted scene to a headless Godot instance, capture the
 *      viewport PNG, and assert it is non-empty + matches the
 *      authored frame size. CI runners without Godot skip the branch
 *      so the test suite stays passable everywhere.
 *
 * The PNG branch is intentionally a smoke test: it proves the emitted
 * `.tscn` is a valid Godot scene that renders to a non-empty image at
 * the requested size. Pixel-perfect comparison against a fig reference
 * is a separate task (needs a fig-side renderer reference, like
 * fig-to-swiftui's WebGL harness, which is out of v0 scope).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createFigSymbolContext, findCanvas } from "@higma-document-io/fig/context";
import {
  buildFrameScene,
  buildFrameTarget,
  emitFrameFile,
  listFrameTargets,
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
import { isGodotAvailable, renderGodotToPng } from "@higma-tools/fig-to-godot/render";

const FIG_URL = new URL("../cases/autolayout/source.fig", import.meta.url);
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

function normalizeValue(value: GodotValue): GodotValue {
  if (value.kind === "enum") {
    return { kind: "int", value: value.value };
  }
  return value;
}

async function loadAutoLayoutFrames(): Promise<
  readonly { node: ReturnType<typeof listFrameTargets>[number]; size: { x: number; y: number } }[]
> {
  const figPath = fileURLToPath(FIG_URL);
  const bytes = new Uint8Array(await readFile(figPath));
  const ctx = await createFigSymbolContext(bytes);
  const canvas = findCanvas(ctx, "AutoLayout Tests");
  if (!canvas) {
    throw new Error("autolayout fixture missing 'AutoLayout Tests' canvas");
  }
  const frames = listFrameTargets(canvas);
  if (frames.length === 0) {
    throw new Error("autolayout fixture has no top-level frames");
  }
  return frames.map((node) => ({
    node,
    size: node.size ?? { x: 200, y: 200 },
  }));
}

const frames = await loadAutoLayoutFrames();
const godotAvailable = await isGodotAvailable();

describe("structural roundtrip — autolayout fixture", () => {
  const sceneNamesUsed = new Set<string>();
  const slugsUsed = new Set<string>();
  const targets = frames.map((f) =>
    buildFrameTarget(f.node, {
      outputDir: "Pages",
      sceneNamesUsed,
      slugsUsed,
    }),
  );

  const structuralRows = targets.map((t) => ({ target: t }));
  it.each(structuralRows)(
    "$target.sceneName — serialize → parse round-trips to the same IR",
    ({ target }) => {
      const original = buildFrameScene(target);
      // Replicate file.ts's "rename root to scene name" so the IR we
      // compare against matches what serializeScene actually printed.
      const expected = {
        ...original,
        root: { ...original.root, name: target.sceneName },
      };
      const text = serializeScene(expected);
      const parsed = parseScene(text);
      // The serializer prints `enum` values as bare integers (Godot
      // stores enums as ints in `.tscn`); the parser cannot recover the
      // symbolic `name` field. Normalise both sides so the compare
      // doesn't trip over that lossy-by-design conversion.
      expect(normalizeScene(parsed)).toEqual(normalizeScene(expected));
    },
  );

  it("produces non-empty .tscn text for every frame", () => {
    for (const target of targets) {
      const file = emitFrameFile(target);
      expect(file.contents).toContain("[gd_scene");
      expect(file.contents.length).toBeGreaterThan(50);
    }
  });
});

(godotAvailable ? describe : describe.skip)("PNG smoke — autolayout fixture (Godot headless)", () => {
  const sceneNamesUsed = new Set<string>();
  const slugsUsed = new Set<string>();
  const targets = frames.map((f) =>
    buildFrameTarget(f.node, {
      outputDir: "Pages",
      sceneNamesUsed,
      slugsUsed,
    }),
  );

  const renderRows = targets.map((t, idx) => {
    const size = frames[idx]!.size;
    return {
      target: t,
      width: Math.max(1, Math.round(size.x)),
      height: Math.max(1, Math.round(size.y)),
    };
  });

  it.each(renderRows)(
    "$target.sceneName — Godot renders a $width x $height PNG without error",
    async ({ target, width, height }) => {
      const file = emitFrameFile(target);
      const result = await renderGodotToPng({
        scene: file.contents,
        width,
        height,
      });
      expect(result.png.length).toBeGreaterThan(PNG_SIGNATURE.length);
      // First eight bytes of any PNG.
      expect(Array.from(result.png.slice(0, 8))).toEqual(Array.from(PNG_SIGNATURE));
      expect(result.width).toBe(width);
      expect(result.height).toBe(height);
    },
    90_000,
  );
});
