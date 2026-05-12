/**
 * @file Unit tests for affine-normalized VECTOR geometry clustering.
 *
 * The clusterer normalises every shape's commands into the unit
 * square and tries 4 reflections. Two shapes that differ only by
 * uniform scale or by axis-aligned reflection end up in the same
 * cluster. A 1-pixel-radius corner difference produces a different
 * normalised command stream and stays in a different cluster.
 */
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import type { FigBlob } from "@higma-document-models/fig/domain";
import type { FigNode, FigPaint } from "@higma-document-models/fig/types";
import { detectGeometryClusters } from "./geometry-clusters";
import { fakeFigNode } from "./test-helpers";

/**
 * Encode a list of (cmdByte, x, y, ...) into the Figma commands blob
 * layout (1 byte command + Float32 little-endian coords).
 */
function encodeBlob(commands: readonly { readonly cmd: number; readonly coords: readonly number[] }[]): FigBlob {
  const totalBytes = commands.reduce((acc, c) => acc + 1 + c.coords.length * 4, 0);
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  const pos = { value: 0 };
  for (const cmd of commands) {
    view.setUint8(pos.value, cmd.cmd);
    pos.value += 1;
    for (const c of cmd.coords) {
      view.setFloat32(pos.value, c, true);
      pos.value += 4;
    }
  }
  return { bytes: Array.from(new Uint8Array(buffer)) };
}

const M = 0x01;
const L = 0x02;
const Z = 0x06;

function rectBlob(width: number, height: number, offsetX = 0, offsetY = 0): FigBlob {
  return encodeBlob([
    { cmd: M, coords: [offsetX, offsetY] },
    { cmd: L, coords: [offsetX + width, offsetY] },
    { cmd: L, coords: [offsetX + width, offsetY + height] },
    { cmd: L, coords: [offsetX, offsetY + height] },
    { cmd: Z, coords: [] },
  ]);
}

/** Triangle pointing up. */
function triangleUp(w: number, h: number): FigBlob {
  return encodeBlob([
    { cmd: M, coords: [w / 2, 0] },
    { cmd: L, coords: [w, h] },
    { cmd: L, coords: [0, h] },
    { cmd: Z, coords: [] },
  ]);
}

/** Triangle pointing down (vertical reflection of triangleUp). */
function triangleDown(w: number, h: number): FigBlob {
  return encodeBlob([
    { cmd: M, coords: [w / 2, h] },
    { cmd: L, coords: [0, 0] },
    { cmd: L, coords: [w, 0] },
    { cmd: Z, coords: [] },
  ]);
}

/** A subtly different triangle — the apex is shifted, not just scaled. */
function triangleAsymmetric(w: number, h: number): FigBlob {
  return encodeBlob([
    { cmd: M, coords: [w * 0.4, 0] },
    { cmd: L, coords: [w, h] },
    { cmd: L, coords: [0, h] },
    { cmd: Z, coords: [] },
  ]);
}

type LoadedShape = { blobs: readonly FigBlob[] };

function isLoadedShape(value: object): value is LoadedShape {
  return "blobs" in value;
}

function loadedWith(blobs: readonly FigBlob[]): LoadedFigFile {
  const candidate: LoadedShape = { blobs };
  if (!isLoadedShape(candidate)) {
    throw new Error("unreachable");
  }
  return candidate as LoadedFigFile;
}

function solid(r: number, g: number, b: number, a = 1): FigPaint {
  return { type: "SOLID", color: { r, g, b, a } };
}

function vec(
  localID: number,
  size: { x: number; y: number },
  fillBlobIdx: number,
  paint: FigPaint,
): FigNode {
  const base = fakeFigNode({
    type: { value: 6, name: "VECTOR" },
    guid: { sessionID: 1, localID },
    name: `v${localID}`,
    size,
    fillPaints: [paint],
  });
  return { ...base, fillGeometry: [{ commandsBlob: fillBlobIdx, windingRule: { value: 0, name: "NONZERO" }, styleID: 0 }] } as FigNode;
}

describe("detectGeometryClusters — affine-normalised", () => {
  it("clusters identical-shape VECTORs of different sizes (scale absorption)", () => {
    // Rectangles of 20x20 and 40x40 — bbox-normalised, both reduce to
    // the unit square and hash identically.
    const small = rectBlob(20, 20);
    const large = rectBlob(40, 40);
    const loaded = loadedWith([small, large]);
    const black = solid(0, 0, 0);
    const roots: FigNode[] = [
      vec(10, { x: 20, y: 20 }, 0, black),
      vec(11, { x: 40, y: 40 }, 1, black),
    ];
    const result = detectGeometryClusters(loaded, roots);
    expect(result.clusters.length).toBe(1);
    expect(result.clusters[0]?.members.length).toBe(2);
  });

  it("clusters non-uniformly-scaled rectangles (20x10 and 60x30) — same unit-square shape", () => {
    const a = rectBlob(20, 10);
    const b = rectBlob(60, 30);
    const loaded = loadedWith([a, b]);
    const black = solid(0, 0, 0);
    const roots: FigNode[] = [
      vec(10, { x: 20, y: 10 }, 0, black),
      vec(11, { x: 60, y: 30 }, 1, black),
    ];
    const result = detectGeometryClusters(loaded, roots);
    expect(result.clusters.length).toBe(1);
  });

  it("does not yet absorb reflections (apply path would need per-instance flip transforms)", () => {
    // Triangles that point in opposite directions stay in different
    // clusters until the apply path can write per-INSTANCE flip
    // transforms. Documented limitation, not a bug.
    const up = triangleUp(20, 30);
    const down = triangleDown(20, 30);
    const loaded = loadedWith([up, down]);
    const black = solid(0, 0, 0);
    const roots: FigNode[] = [
      vec(10, { x: 20, y: 30 }, 0, black),
      vec(11, { x: 20, y: 30 }, 1, black),
    ];
    const result = detectGeometryClusters(loaded, roots);
    expect(result.clusters.length).toBe(0);
  });

  it("keeps a similar-but-not-identical triangle in a separate cluster (no ε)", () => {
    const symmetric = triangleUp(20, 30);
    const asymmetric = triangleAsymmetric(20, 30);
    const loaded = loadedWith([symmetric, asymmetric]);
    const black = solid(0, 0, 0);
    const roots: FigNode[] = [
      vec(10, { x: 20, y: 30 }, 0, black),
      vec(11, { x: 20, y: 30 }, 1, black),
    ];
    const result = detectGeometryClusters(loaded, roots);
    expect(result.clusters.length).toBe(0);
  });

  it("separates VECTORs whose SOLID colour differs in any channel", () => {
    const blob = rectBlob(20, 20);
    const loaded = loadedWith([blob]);
    const roots: FigNode[] = [
      vec(10, { x: 20, y: 20 }, 0, solid(0, 0, 0)),
      vec(11, { x: 20, y: 20 }, 0, solid(1, 0, 0)),
    ];
    const result = detectGeometryClusters(loaded, roots);
    expect(result.clusters.length).toBe(0);
  });

  it("does not emit clusters of size 1", () => {
    const blob = rectBlob(20, 20);
    const loaded = loadedWith([blob]);
    const roots: FigNode[] = [vec(10, { x: 20, y: 20 }, 0, solid(0, 0, 0))];
    const result = detectGeometryClusters(loaded, roots);
    expect(result.clusters.length).toBe(0);
  });

  it("rejects degenerate (1-D) shapes — bbox of zero width or height", () => {
    // Horizontal line: all y are zero, so bbox height == 0.
    const horizontalLine: FigBlob = encodeBlob([
      { cmd: M, coords: [0, 0] },
      { cmd: L, coords: [10, 0] },
      { cmd: Z, coords: [] },
    ]);
    const loaded = loadedWith([horizontalLine, horizontalLine]);
    const black = solid(0, 0, 0);
    const roots: FigNode[] = [
      vec(10, { x: 10, y: 1 }, 0, black),
      vec(11, { x: 10, y: 1 }, 1, black),
    ];
    const result = detectGeometryClusters(loaded, roots);
    expect(result.clusters.length).toBe(0);
  });

  it("clusterId is stable across runs (same input → same id)", () => {
    const blob = rectBlob(20, 20);
    const loaded = loadedWith([blob]);
    const black = solid(0, 0, 0);
    const roots: FigNode[] = [
      vec(10, { x: 20, y: 20 }, 0, black),
      vec(11, { x: 20, y: 20 }, 0, black),
    ];
    const a = detectGeometryClusters(loaded, roots);
    const b = detectGeometryClusters(loaded, roots);
    expect(a.clusters[0]?.clusterId).toBe(b.clusters[0]?.clusterId);
    expect(a.clusters[0]?.clusterId).toMatch(/^vec-[0-9a-f]{12}$/u);
  });
});
