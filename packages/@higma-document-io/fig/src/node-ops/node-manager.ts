/** @file Node operations on the Kiwi document SoT. */

import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import { guidToString } from "@higma-document-models/fig/domain";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import {
  replaceFigDocumentContextNodeChanges,
  type FigDocumentContext,
} from "../context";
import type { NodeSpec } from "../types/spec-types";
import { createNodeFromSpec } from "./node-factory";
import { addBlobToFigDocumentContext } from "../context/document-context";
import {
  autoFillGeometryBytes,
  specProducesFill,
  specProducesStroke,
} from "./geometry-auto";
import { WINDING_RULE_VALUES, toEnumValue } from "@higma-document-models/fig/constants";

const POSITION_FIRST_CHAR = 0x21;

function positionString(index: number): string {
  return String.fromCharCode(POSITION_FIRST_CHAR + index);
}

function contextWithNodes(context: FigDocumentContext, nodeChanges: readonly FigNode[]): FigDocumentContext {
  return replaceFigDocumentContextNodeChanges({ context, nodeChanges });
}

/**
 * Attach the auto-generated geometry blob entry to the right slot
 * on the node — `strokeGeometry` for path-only shapes (LINE has no
 * fill region), `fillGeometry` for closed shapes. Closed shapes also
 * carry the entry in `strokeGeometry` when they have a visible
 * stroke, but the auto path emits it on the fill slot only — the
 * renderer reuses the same blob for stroke when needed via the
 * fill-geometry-shared-by-stroke path.
 */
type GeometryEntry = {
  readonly commandsBlob: number;
  readonly windingRule: ReturnType<typeof toEnumValue<"NONZERO" | "ODD">>;
  readonly styleID: number;
};

function attachGeometry(
  node: FigNode,
  spec: NodeSpec,
  entry: readonly GeometryEntry[],
): FigNode {
  if (specProducesStroke(spec)) {
    return { ...node, strokeGeometry: entry };
  }
  if (specProducesFill(spec)) {
    return { ...node, fillGeometry: entry };
  }
  return node;
}

function siblingIndex(context: FigDocumentContext, parentGuid: FigGuid): number {
  const parent = context.document.nodesByGuid.get(guidToString(parentGuid));
  if (parent === undefined) {
    throw new Error(`addNode: parent ${guidToString(parentGuid)} does not exist`);
  }
  return context.document.childrenOf(parent).length;
}

type AddNodeOptions = {
  readonly state: FigBuilderState;
  readonly context: FigDocumentContext;
  readonly pageGuid: FigGuid;
  readonly parentGuid: FigGuid | null;
  readonly spec: NodeSpec;
};

type UpdateNodeOptions = {
  readonly context: FigDocumentContext;
  readonly nodeGuid: FigGuid;
  readonly update: (node: FigNode) => FigNode;
};

/**
 * Append a new Kiwi node under an explicit page/parent GUID.
 *
 * For shape specs (RECTANGLE / ROUNDED_RECTANGLE / ELLIPSE / STAR /
 * REGULAR_POLYGON / LINE) the synthesised fillGeometry blob is
 * registered on the document and the node's `fillGeometry[0]` (or
 * `strokeGeometry[0]` for LINE) points at the resulting blob index.
 * Figma's importer rejects shapes whose commandsBlob is absent — the
 * editor opens such a file with every layer invisible. Generating
 * the blob here mirrors Figma's own exporter behaviour so the
 * fixtures round-trip through Figma desktop with the shapes
 * actually painted.
 */
export function addNode(
  { state, context, pageGuid, parentGuid, spec }: AddNodeOptions,
): { readonly context: FigDocumentContext; readonly nodeGuid: FigGuid } {
  const targetParentGuid = parentGuid ?? pageGuid;
  const position = positionString(siblingIndex(context, targetParentGuid));
  const baseNode = createNodeFromSpec({
    state,
    parentGuid: targetParentGuid,
    position,
    spec,
  });
  const geometryBytes = autoFillGeometryBytes(spec);
  if (geometryBytes === undefined) {
    return {
      context: contextWithNodes(context, [...context.document.nodeChanges, baseNode]),
      nodeGuid: baseNode.guid,
    };
  }
  const blobResult = addBlobToFigDocumentContext({ context, blob: { bytes: Array.from(geometryBytes) } });
  // `styleID: 0` is the load-bearing default real Figma exports
  // always emit on `fillGeometry[i]` / `strokeGeometry[i]` —
  // `0` is the Kiwi schema's "no style override" sentinel for the
  // per-geometry styleID slot. Omitting it makes Figma's importer
  // render the shape as transparent (the slot exists in the schema
  // and is read as `undefined`, which the renderer treats as "skip
  // this geometry entry"). See `/Users/terukichi/Downloads/shapes.fig`
  // bit-for-bit comparison against the broken regen for the
  // empirical confirmation.
  const geometryEntry = [{
    commandsBlob: blobResult.blobIndex,
    windingRule: toEnumValue("NONZERO", WINDING_RULE_VALUES)!,
    styleID: 0,
  }];
  const nodeWithGeometry = attachGeometry(baseNode, spec, geometryEntry);
  return {
    context: contextWithNodes(blobResult.context, [...blobResult.context.document.nodeChanges, nodeWithGeometry]),
    nodeGuid: nodeWithGeometry.guid,
  };
}

/**
 * Replace one Kiwi node by GUID and re-index the same document context.
 */
export function updateNode(
  { context, nodeGuid, update }: UpdateNodeOptions,
): FigDocumentContext {
  const key = guidToString(nodeGuid);
  const node = context.document.nodesByGuid.get(key);
  if (node === undefined) {
    throw new Error(`updateNode: node ${key} does not exist`);
  }
  const updated = update(node);
  if (guidToString(updated.guid) !== key) {
    throw new Error(`updateNode: update changed node guid ${key} to ${guidToString(updated.guid)}`);
  }
  return contextWithNodes(
    context,
    context.document.nodeChanges.map((current) => (guidToString(current.guid) === key ? updated : current)),
  );
}
