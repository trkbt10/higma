/**
 * @file Bootstrap a FILL-style proxy in a file that has none.
 *
 * `synthesiseFillProxy` clones the *shape* of an existing FILL-style
 * proxy. That works for the common case where the file already
 * carries at least one published fill style — the new proxy is the
 * old one with a different colour and name. Files exported from
 * Figma sometimes contain zero FILL style proxies, though, and the
 * clone strategy has nothing to clone there.
 *
 * Bootstrap fixes that case. It builds the proxy from scratch:
 *
 *   - Encode a 100×100 axis-aligned rectangle as a path commands blob
 *     (`M 0 0; L 100 0; L 100 100; L 0 100; L 0 0`) and append it
 *     to `loaded.blobs`. The encoding matches the format used by
 *     real Figma exports for swatch-shape proxies — every existing
 *     FILL proxy in the corpus carries this exact path, transformed
 *     by the proxy node's own transform / size.
 *   - Allocate a fresh GUID via the caller-supplied allocator.
 *   - Construct a ROUNDED_RECTANGLE FigNode whose `fillPaints` is
 *     the requested SOLID colour, `fillGeometry` references the
 *     newly-appended blob index, and `styleType.name === "FILL"` so
 *     the `bind-fill-style` action can target it.
 *   - Park the node under the supplied Internal Only Canvas with a
 *     stable but unique sortPosition so Figma does not collapse it
 *     into an existing publishable bucket.
 *
 * The bookkeeping fields (`isPublishable`, `locked`, `visible`,
 * `opacity`, `transform`, `strokeWeight`, `strokeAlign`, `strokeJoin`,
 * `phase`) match the values seen on real exports' fill proxies, so
 * `runFigHealthCheck` accepts the result and Figma does not regard
 * the bootstrapped proxy as a malformed shape.
 */
import type { FigBlob } from "@higma-document-models/fig/domain";
import type { FigColor, FigNode } from "@higma-document-models/fig/types";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import type { GuidAllocator } from "@higma-document-io/fig/roundtrip";
import { addBlob, addNodeChange } from "@higma-document-io/fig/roundtrip";

const SWATCH_SIZE = 100;

export type BootstrapFillProxyArgs = {
  readonly loaded: LoadedFigFile;
  /** GUID string of the Internal Only Canvas (e.g. "0:2"). */
  readonly internalCanvasGuid: string;
  readonly allocator: GuidAllocator;
  readonly name: string;
  readonly color: FigColor;
};

/** Insert a new FILL-style proxy without cloning a template. */
export function bootstrapFillProxy(args: BootstrapFillProxyArgs): { readonly guid: string; readonly node: FigNode } {
  const { loaded, internalCanvasGuid, allocator, name, color } = args;
  const blobIndex = addBlob(loaded, encodeRectangleCommandsBlob(SWATCH_SIZE, SWATCH_SIZE));
  const newGuid = allocator.next();
  const internalGuid = parseGuidString(internalCanvasGuid);

  const newNode: FigNode = {
    guid: newGuid,
    phase: { value: 0, name: "CREATED" },
    parentIndex: { guid: internalGuid, position: nextSortPosition(loaded, internalCanvasGuid) },
    type: { value: 12, name: "ROUNDED_RECTANGLE" },
    name,
    isPublishable: false,
    styleType: { value: 1, name: "FILL" },
    visible: false,
    locked: true,
    opacity: 1,
    size: { x: SWATCH_SIZE, y: SWATCH_SIZE },
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    strokeWeight: 1,
    strokeAlign: "INSIDE",
    strokeJoin: "MITER",
    fillPaints: [
      {
        type: "SOLID",
        color,
        opacity: 1,
        visible: true,
        blendMode: "NORMAL",
      },
    ],
    fillGeometry: [
      {
        windingRule: { value: 0, name: "NONZERO" },
        commandsBlob: blobIndex,
        styleID: 0,
      },
    ],
  };
  addNodeChange(loaded, newNode);
  return { guid: `${newGuid.sessionID}:${newGuid.localID}`, node: newNode };
}

/**
 * Encode `M 0 0; L w 0; L w h; L 0 h; L 0 0` as a Figma path commands
 * blob (the format consumed by `decodePathCommands`).
 *
 * Each command byte is followed by two little-endian Float32 (x, y)
 * coordinates; closing the ring with an explicit L back to (0, 0)
 * matches what real Figma exports do for swatch-shape proxies (no
 * trailing Z byte on this class of blob).
 */
function encodeRectangleCommandsBlob(width: number, height: number): FigBlob {
  const moves: { readonly cmd: number; readonly x: number; readonly y: number }[] = [
    { cmd: 0x01, x: 0, y: 0 },
    { cmd: 0x02, x: width, y: 0 },
    { cmd: 0x02, x: width, y: height },
    { cmd: 0x02, x: 0, y: height },
    { cmd: 0x02, x: 0, y: 0 },
  ];
  const buffer = new ArrayBuffer(moves.length * 9);
  const view = new DataView(buffer);
  for (const [i, m] of moves.entries()) {
    const offset = i * 9;
    view.setUint8(offset, m.cmd);
    view.setFloat32(offset + 1, m.x, true);
    view.setFloat32(offset + 5, m.y, true);
  }
  const u8 = new Uint8Array(buffer);
  return { bytes: Array.from(u8) };
}

function parseGuidString(s: string): { sessionID: number; localID: number } {
  const [a, b] = s.split(":");
  if (a === undefined || b === undefined) {
    throw new Error(`bootstrapFillProxy: bad guid string "${s}"`);
  }
  const sessionID = Number.parseInt(a, 10);
  const localID = Number.parseInt(b, 10);
  if (!Number.isFinite(sessionID) || !Number.isFinite(localID)) {
    throw new Error(`bootstrapFillProxy: non-numeric guid "${s}"`);
  }
  return { sessionID, localID };
}

/**
 * Pick a sortPosition that orders strictly after every existing
 * direct child of the internal canvas. Figma's sort positions are
 * lexicographic strings; appending a single character past the
 * highest seen value is enough to land at the end without colliding
 * with any neighbour.
 */
function nextSortPosition(loaded: LoadedFigFile, parentGuidString: string): string {
  const positions = loaded.nodeChanges
    .filter((n) => {
      const p = n.parentIndex;
      if (!p) {
        return false;
      }
      return `${p.guid.sessionID}:${p.guid.localID}` === parentGuidString;
    })
    .map((n) => n.parentIndex?.position ?? "");
  if (positions.length === 0) {
    return "z";
  }
  const max = positions.reduce((best, p) => (p > best ? p : best), positions[0] ?? "");
  return `${max}z`;
}
