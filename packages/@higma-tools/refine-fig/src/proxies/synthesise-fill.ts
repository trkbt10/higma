/**
 * @file Synthesise a new FILL-style proxy on the Internal Only Canvas.
 *
 * Strategy: clone the *shape* of an existing FILL proxy already in
 * the file (every published Figma file has at least one — they are
 * how shared fill styles are persisted) and substitute:
 *
 *   - `guid` with a freshly-allocated GUID,
 *   - `name` with the agent's authored name,
 *   - `fillPaints` with a single SOLID paint of the requested colour,
 *   - `parentIndex.guid` so the new node sits under the same Internal
 *     Only Canvas the existing proxies use.
 *
 * `fillGeometry` is borrowed verbatim. Every existing FILL proxy in
 * the file is a 100×100 rounded-rectangle showing the colour swatch
 * — its blob path is geometric only and contains no colour data, so
 * reusing it is safe and produces a valid Figma node without
 * touching the blob encoder.
 *
 * `version` and `sortPosition` are also borrowed; Figma tolerates
 * duplicate sort positions (it falls back to GUID order) and the
 * version string is opaque metadata.
 */
import type { FigColor, FigNode } from "@higma-document-models/fig/types";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import type { GuidAllocator } from "@higma-document-io/fig/roundtrip";
import { addNodeChange } from "@higma-document-io/fig/roundtrip";

export type SynthesiseFillProxyArgs = {
  readonly loaded: LoadedFigFile;
  /** GUID string of the Internal Only Canvas (e.g. "0:2"). */
  readonly internalCanvasGuid: string;
  /** GUID of an existing FILL-style proxy whose shape we'll clone. */
  readonly templateProxyGuid: string;
  readonly allocator: GuidAllocator;
  readonly name: string;
  readonly color: FigColor;
};

/** Insert a new FILL-style proxy by cloning an existing template proxy. */
export function synthesiseFillProxy(args: SynthesiseFillProxyArgs): { readonly guid: string; readonly node: FigNode } {
  const { loaded, internalCanvasGuid, templateProxyGuid, allocator, name, color } = args;
  const template = findByGuid(loaded, templateProxyGuid);
  if (!template) {
    throw new Error(`synthesiseFillProxy: template proxy ${templateProxyGuid} not found in loaded file`);
  }
  if (template.styleType?.name !== "FILL") {
    throw new Error(`synthesiseFillProxy: template ${templateProxyGuid} is not a FILL-style proxy`);
  }
  const newGuid = allocator.next();
  const internalGuid = parseGuidString(internalCanvasGuid);

  const newNode: FigNode = {
    ...template,
    guid: newGuid,
    name,
    parentIndex: rebaseParent(template, internalGuid),
    fillPaints: [
      {
        type: "SOLID",
        color,
        opacity: 1,
        visible: true,
        blendMode: "NORMAL",
      },
    ],
  };
  addNodeChange(loaded, newNode);
  return { guid: `${newGuid.sessionID}:${newGuid.localID}`, node: newNode };
}

function rebaseParent(
  template: FigNode,
  newParentGuid: { sessionID: number; localID: number },
): { guid: { sessionID: number; localID: number }; position: string } {
  if (template.parentIndex) {
    return { ...template.parentIndex, guid: newParentGuid };
  }
  return { guid: newParentGuid, position: "z" };
}

function findByGuid(loaded: LoadedFigFile, guidString: string): FigNode | undefined {
  return loaded.nodeChanges.find((n) => {
    const g = n.guid;
    if (!g) {
      return false;
    }
    return `${g.sessionID}:${g.localID}` === guidString;
  });
}

function parseGuidString(s: string): { sessionID: number; localID: number } {
  const [a, b] = s.split(":");
  if (a === undefined || b === undefined) {
    throw new Error(`synthesiseFillProxy: bad guid string "${s}"`);
  }
  const sessionID = Number.parseInt(a, 10);
  const localID = Number.parseInt(b, 10);
  if (!Number.isFinite(sessionID) || !Number.isFinite(localID)) {
    throw new Error(`synthesiseFillProxy: non-numeric guid "${s}"`);
  }
  return { sessionID, localID };
}
