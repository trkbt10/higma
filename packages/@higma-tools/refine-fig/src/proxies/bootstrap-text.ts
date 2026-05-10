/**
 * @file Bootstrap a TEXT-style proxy in a file that has none.
 *
 * Mirror of `bootstrap-fill` for typography. Files with at least one
 * TEXT proxy can grow more via `synthesiseTextProxy` (which clones a
 * template). Files with zero TEXT proxies have nothing to clone, so
 * the agent's text-style decisions previously surfaced as
 * `missingTemplates` diagnostics with no way to land them. This
 * helper builds a structurally-valid TEXT proxy by hand.
 *
 * Strategy:
 *
 *   - Allocate a fresh GUID via the supplied allocator.
 *   - Park the new TEXT node under the Internal Only Canvas with a
 *     stable but unique sortPosition.
 *   - Carry the agent-supplied descriptor (font, size, line-height,
 *     letter-spacing) on the node.
 *   - Emit a minimal `textData` shape — a single `PLAIN` line with
 *     `characters: ""` and the line-table fields Figma requires for
 *     a parseable text proxy. `derivedTextData` is left undefined;
 *     Figma re-derives it on the next open against whatever the
 *     descriptor's font resolves to. This is the same fail-fast path
 *     the existing `synthesiseTextProxy` relies on for the cloned
 *     case — the bootstrap path makes the same assumption explicit.
 *   - Set `strokeWeight: 0`, `strokeAlign: INSIDE`, `strokeJoin:
 *     MITER` so the `fig.shape.stroke-fields` lint rule accepts the
 *     node.
 *
 * The 22×22 placeholder size matches what real Figma exports use
 * for text-style swatch nodes; Figma re-flows the proxy on next open
 * once `derivedTextData` is rebuilt.
 */
import type { FigFontName, FigKiwiTextData, FigNode, FigValueWithUnits } from "@higma-document-models/fig/types";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import type { GuidAllocator } from "@higma-document-io/fig/roundtrip";
import { addNodeChange } from "@higma-document-io/fig/roundtrip";

const PROXY_SIZE = 22;

export type BootstrapTextProxyArgs = {
  readonly loaded: LoadedFigFile;
  readonly internalCanvasGuid: string;
  readonly allocator: GuidAllocator;
  readonly name: string;
  readonly fontName: FigFontName;
  readonly fontSize: number;
  readonly lineHeight?: FigValueWithUnits;
  readonly letterSpacing?: FigValueWithUnits;
};

/** Insert a new TEXT-style proxy without cloning a template. */
export function bootstrapTextProxy(args: BootstrapTextProxyArgs): { readonly guid: string; readonly node: FigNode } {
  const { loaded, internalCanvasGuid, allocator, name, fontName, fontSize, lineHeight, letterSpacing } = args;
  const newGuid = allocator.next();
  const internalGuid = parseGuidString(internalCanvasGuid);

  const newNode: FigNode = {
    guid: newGuid,
    phase: { value: 0, name: "CREATED" },
    parentIndex: { guid: internalGuid, position: nextSortPosition(loaded, internalCanvasGuid) },
    type: { value: 13, name: "TEXT" },
    name,
    isPublishable: false,
    styleType: { value: 3, name: "TEXT" },
    visible: false,
    locked: true,
    opacity: 1,
    size: { x: PROXY_SIZE, y: PROXY_SIZE },
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    strokeWeight: 0,
    strokeAlign: "INSIDE",
    strokeJoin: "MITER",
    fontName,
    fontSize,
    ...(lineHeight ? { lineHeight } : {}),
    ...(letterSpacing ? { letterSpacing } : {}),
    textAlignVertical: { value: 0, name: "TOP" },
    textData: makeMinimalTextData(),
  };
  addNodeChange(loaded, newNode);
  return { guid: `${newGuid.sessionID}:${newGuid.localID}`, node: newNode };
}

/**
 * Minimal `FigKiwiTextData`: an empty character buffer plus a single
 * `PLAIN` line with the line-table fields Figma's parser relies on.
 * `derivedTextData` is intentionally omitted — Figma rebuilds it on
 * next open.
 */
function makeMinimalTextData(): FigKiwiTextData {
  return {
    characters: "",
    lines: [
      {
        lineType: { value: 0, name: "PLAIN" },
        styleId: 0,
        indentationLevel: 0,
        sourceDirectionality: { value: 0, name: "AUTO" },
        listStartOffset: 0,
        isFirstLineOfList: false,
      },
    ],
  } as FigKiwiTextData;
}

function parseGuidString(s: string): { sessionID: number; localID: number } {
  const [a, b] = s.split(":");
  if (a === undefined || b === undefined) {
    throw new Error(`bootstrapTextProxy: bad guid string "${s}"`);
  }
  const sessionID = Number.parseInt(a, 10);
  const localID = Number.parseInt(b, 10);
  if (!Number.isFinite(sessionID) || !Number.isFinite(localID)) {
    throw new Error(`bootstrapTextProxy: non-numeric guid "${s}"`);
  }
  return { sessionID, localID };
}

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
