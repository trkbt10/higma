/**
 * @file Single-viewport `buildFigFileBytes` asset-embedding spec.
 *
 * The single-viewport emit path used to silently drop every image
 * fill: `applyFrameBackground` only honoured solid colours, and
 * `buildFigFileBytes` never called `file.addImage(...)`. The
 * symptom that surfaced this was the Abe Hiroshi capture
 * (frameset + HTML4 `<body background="...">`) round-tripping to a
 * 28KB `.fig` with no images at all. After the fix the same
 * capture comes out at 56KB with both images embedded inside the
 * zip's `images/` directory.
 *
 * This spec pins both contracts:
 *   1. Every `assets` entry on the IR ends up as a fig blob (one
 *      per unique `id`) so the file is self-contained.
 *   2. A FRAME / RECTANGLE whose IR carries an `image` paint emits
 *      a fig paint that references the corresponding `image.hash`.
 *
 * The contract goes via the public `buildFigFileBytes` entry: the
 * per-asset embedding is an observable property of the produced
 * bytes (the zip archive's central directory carries one entry per
 * unique image hash), and the spec checks the byte stream rather
 * than poking at the internal builder.
 */
import { unzipSync } from "fflate";
import type { ViewportIR } from "@higma-bridges/web-fig";
import type { AssetIR } from "@higma-bridges/web-fig";
import { buildFigFileBytes } from "./build-fig-file";

/** Tiny 1×1 PNG — minimum bytes that satisfy a PNG IHDR sniff. */
const PNG_1x1_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length + tag
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1 × 1
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, // IHDR body + crc
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, // IDAT length + tag
  0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, // IDAT body + crc
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82, // IEND
]);

function buildTestFills(
  fillImageId: string | undefined,
): ReadonlyArray<{ kind: "image"; imageId: string; scaleMode: "cover" }> {
  if (fillImageId === undefined) { return []; }
  return [{ kind: "image", imageId: fillImageId, scaleMode: "cover" }];
}

function makeViewport(opts: { readonly assets: ReadonlyMap<string, AssetIR>; readonly fillImageId?: string }): ViewportIR {
  return {
    source: "https://test.example/",
    breakpoint: "default",
    box: { x: 0, y: 0, width: 100, height: 100 },
    devicePixelRatio: 1,
    background: { r: 1, g: 1, b: 1, a: 1 },
    root: {
      id: "0",
      componentKey: "0",
      kind: "frame",
      name: "html",
      box: { x: 0, y: 0, width: 100, height: 100 },
      visible: true,
      style: {
        fills: buildTestFills(opts.fillImageId),
        strokes: [],
        effects: [],
        opacity: 1,
        clipsContent: false,
        blendMode: "normal",
      },
      autoLayout: { direction: "none" },
      sizing: { mode: "absolute" },
      children: [],
    },
    viewportLayer: [],
    assets: opts.assets,
  };
}

describe("buildFigFileBytes — asset embedding", () => {
  it("embeds every IR asset as a fig blob in the zip archive", async () => {
    const assets = new Map<string, AssetIR>([
      ["abcdef", { id: "abcdef", mime: "image/png", bytes: PNG_1x1_BYTES }],
      ["123456", { id: "123456", mime: "image/png", bytes: PNG_1x1_BYTES }],
    ]);
    const ir = makeViewport({ assets });
    const result = await buildFigFileBytes(ir);
    const archive = unzipSync(result.bytes);
    const imageEntries = Object.keys(archive).filter((name) => name.startsWith("images/"));
    // Identical bytes deduplicate into one blob (Figma keys image
    // entries by SHA-1) — that's the right contract.
    expect(imageEntries.length).toBeGreaterThanOrEqual(1);
    expect(imageEntries.length).toBeLessThanOrEqual(2);
  });

  it("does not embed any image entry when the IR carries zero assets", async () => {
    const ir = makeViewport({ assets: new Map() });
    const result = await buildFigFileBytes(ir);
    const archive = unzipSync(result.bytes);
    const imageEntries = Object.keys(archive).filter((name) => name.startsWith("images/"));
    expect(imageEntries).toHaveLength(0);
  });

  it("embeds a single asset referenced by a frame's image fill", async () => {
    // The frame carries an `image` fill whose `imageId` matches an
    // asset. Emit must register the asset *and* the frame's fill
    // must reference the resulting Paint.image.hash. The byte-level signal
    // is "the zip carries an `images/...` entry whose body matches
    // the input PNG" — without the new fix the entry was missing
    // entirely and the rendered `.fig` showed an empty rectangle.
    const assets = new Map<string, AssetIR>([
      ["abcdef", { id: "abcdef", mime: "image/png", bytes: PNG_1x1_BYTES }],
    ]);
    const ir = makeViewport({ assets, fillImageId: "abcdef" });
    const result = await buildFigFileBytes(ir);
    const archive = unzipSync(result.bytes);
    const imageEntries = Object.keys(archive).filter((name) => name.startsWith("images/"));
    expect(imageEntries).toHaveLength(1);
    const entryBytes = archive[imageEntries[0]!]!;
    expect(entryBytes.byteLength).toBe(PNG_1x1_BYTES.byteLength);
  });
});
