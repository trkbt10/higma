/** @file Node operations on the Kiwi document SoT. */

import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import { guidToString } from "@higma-document-models/fig/domain";
import type { FigBuilderState } from "@higma-document-models/fig/builder";
import {
  createFigDocumentContextFromNodeChanges,
  type FigDocumentContext,
} from "../context";
import type { NodeSpec } from "../types/spec-types";
import { createNodeFromSpec } from "./node-factory";

const POSITION_FIRST_CHAR = 0x21;

function positionString(index: number): string {
  return String.fromCharCode(POSITION_FIRST_CHAR + index);
}

function contextWithNodes(context: FigDocumentContext, nodeChanges: readonly FigNode[]): FigDocumentContext {
  return createFigDocumentContextFromNodeChanges({
    nodeChanges,
    blobs: context.blobs,
    images: context.images,
    metadata: context.metadata,
  });
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

/**
 * Append a new Kiwi node under an explicit page/parent GUID.
 */
export function addNode(
  { state, context, pageGuid, parentGuid, spec }: AddNodeOptions,
): { readonly context: FigDocumentContext; readonly nodeGuid: FigGuid } {
  const targetParentGuid = parentGuid ?? pageGuid;
  const position = positionString(siblingIndex(context, targetParentGuid));
  const node = createNodeFromSpec({
    state,
    parentGuid: targetParentGuid,
    position,
    spec,
  });
  return {
    context: contextWithNodes(context, [...context.document.nodeChanges, node]),
    nodeGuid: node.guid,
  };
}
