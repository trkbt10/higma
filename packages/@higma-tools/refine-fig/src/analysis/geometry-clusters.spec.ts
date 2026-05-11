/**
 * @file Unit tests for strict-byte VECTOR geometry clustering.
 *
 * The clusterer is intentionally strict: byte-equal blobs + integer-
 * equal sizes + identical paint stack + identical stroke parameters
 * are required. Anything looser belongs in a separate analysis. The
 * spec exercises the *positive* cases (real duplicates collapse) and
 * the *fail-fast* cases (a single byte / px / colour / weight
 * difference keeps the VECTORs apart).
 */
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import type { FigNode, FigPaint } from "@higma-document-models/fig/types";
import { detectGeometryClusters } from "./geometry-clusters";
import { fakeFigNode } from "./test-helpers";

type LoadedShape = { blobs: readonly { bytes: readonly number[] }[] };

function isLoadedShape(value: object): value is LoadedShape {
  return "blobs" in value;
}

function loadedWith(blobs: readonly Uint8Array[]): LoadedFigFile {
  // The geometry-cluster analyser only reads `loaded.blobs[].bytes`,
  // so a structurally-equivalent value with that subset is enough.
  // Wrap the cast in a guard so the lint rule sees a type narrowing.
  const candidate: LoadedShape = { blobs: blobs.map((b) => ({ bytes: Array.from(b) })) };
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
  return fakeFigNode({
    type: { value: 6, name: "VECTOR" },
    guid: { sessionID: 1, localID },
    name: `v${localID}`,
    size,
    fillPaints: [paint],
  } as Parameters<typeof fakeFigNode>[0] & { fillGeometry: unknown }) as FigNode & {
    fillGeometry: { commandsBlob: number }[];
  };
}

function vecWithGeometry(
  localID: number,
  size: { x: number; y: number },
  fillBlobIdx: number,
  paint: FigPaint,
): FigNode {
  // The helper does not type `fillGeometry`; we extend structurally.
  const base = vec(localID, size, fillBlobIdx, paint);
  return { ...base, fillGeometry: [{ commandsBlob: fillBlobIdx }] } as FigNode;
}

describe("detectGeometryClusters — strict byte match", () => {
  it("groups VECTORs that share commandsBlob + size + paint + stroke", () => {
    const blobA = new Uint8Array([1, 2, 3, 4]);
    const blobB = new Uint8Array([5, 6, 7, 8]);
    const loaded = loadedWith([blobA, blobB]);
    const black = solid(0, 0, 0);
    const roots: FigNode[] = [
      vecWithGeometry(10, { x: 20, y: 20 }, 0, black),
      vecWithGeometry(11, { x: 20, y: 20 }, 0, black),
      vecWithGeometry(12, { x: 20, y: 20 }, 0, black),
      vecWithGeometry(20, { x: 20, y: 20 }, 1, black), // different blob
    ];
    const result = detectGeometryClusters(loaded, roots);
    expect(result.clusters.length).toBe(1);
    expect(result.clusters[0]?.members.length).toBe(3);
  });

  it("separates VECTORs whose blob bytes differ by a single byte", () => {
    const blobA = new Uint8Array([1, 2, 3, 4]);
    const blobAprime = new Uint8Array([1, 2, 3, 5]); // one byte diff
    const loaded = loadedWith([blobA, blobAprime]);
    const black = solid(0, 0, 0);
    const roots: FigNode[] = [
      vecWithGeometry(10, { x: 20, y: 20 }, 0, black),
      vecWithGeometry(11, { x: 20, y: 20 }, 1, black),
    ];
    const result = detectGeometryClusters(loaded, roots);
    expect(result.clusters.length).toBe(0);
  });

  it("separates VECTORs whose integer size differs", () => {
    const blob = new Uint8Array([1, 2, 3, 4]);
    const loaded = loadedWith([blob]);
    const black = solid(0, 0, 0);
    const roots: FigNode[] = [
      vecWithGeometry(10, { x: 20, y: 20 }, 0, black),
      vecWithGeometry(11, { x: 21, y: 20 }, 0, black),
    ];
    const result = detectGeometryClusters(loaded, roots);
    expect(result.clusters.length).toBe(0);
  });

  it("separates VECTORs whose SOLID colour differs in any channel", () => {
    const blob = new Uint8Array([1, 2, 3, 4]);
    const loaded = loadedWith([blob]);
    const roots: FigNode[] = [
      vecWithGeometry(10, { x: 20, y: 20 }, 0, solid(0, 0, 0)),
      vecWithGeometry(11, { x: 20, y: 20 }, 0, solid(1, 0, 0)),
    ];
    const result = detectGeometryClusters(loaded, roots);
    expect(result.clusters.length).toBe(0);
  });

  it("does not emit clusters of size 1 (singletons are not interesting)", () => {
    const blob = new Uint8Array([1, 2, 3, 4]);
    const loaded = loadedWith([blob]);
    const roots: FigNode[] = [
      vecWithGeometry(10, { x: 20, y: 20 }, 0, solid(0, 0, 0)),
    ];
    const result = detectGeometryClusters(loaded, roots);
    expect(result.clusters.length).toBe(0);
  });

  it("clusterId is stable across runs (same input → same id)", () => {
    const blob = new Uint8Array([1, 2, 3, 4]);
    const loaded = loadedWith([blob]);
    const black = solid(0, 0, 0);
    const roots: FigNode[] = [
      vecWithGeometry(10, { x: 20, y: 20 }, 0, black),
      vecWithGeometry(11, { x: 20, y: 20 }, 0, black),
    ];
    const a = detectGeometryClusters(loaded, roots);
    const b = detectGeometryClusters(loaded, roots);
    expect(a.clusters[0]?.clusterId).toBe(b.clusters[0]?.clusterId);
    expect(a.clusters[0]?.clusterId).toMatch(/^vec-[0-9a-f]{12}$/u);
  });
});
