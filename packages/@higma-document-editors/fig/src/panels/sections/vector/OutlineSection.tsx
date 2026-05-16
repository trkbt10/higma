/** @file Outline conversion controls adapter. */

import type { FigDesignNode } from "@higma-document-models/fig/domain";
import { OutlineSectionView } from "@higma-editor-kernel/ui/property-sections";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { allowsFigUserOperation, type FigUserOperationDomain } from "../../../context/fig-editor/user-operation";

type OutlineSectionProps = {
  readonly node: FigDesignNode;
  readonly dispatch: (action: FigEditorAction) => void;
  readonly operationDomain?: FigUserOperationDomain;
};

function supportsOutline(node: FigDesignNode): boolean {
  return node.type === "RECTANGLE"
    || node.type === "ROUNDED_RECTANGLE"
    || node.type === "ELLIPSE"
    || node.type === "LINE"
    || node.type === "REGULAR_POLYGON"
    || node.type === "STAR"
    || node.type === "VECTOR"
    || node.type === "TEXT";
}

/** Convert shape/text nodes to explicit VECTOR paths when source geometry is available. */
export function OutlineSection({ node, dispatch, operationDomain }: OutlineSectionProps) {
  const allowed = operationDomain ? allowsFigUserOperation(operationDomain, "outline-selection") : true;
  const enabled = supportsOutline(node) && allowed;
  const note = node.type === "TEXT" ? "Text outlines require glyph path data in the fig document." : undefined;
  return (
    <OutlineSectionView
      enabled={enabled}
      onOutline={() => dispatch({ type: "OUTLINE_SELECTION" })}
      note={note}
    />
  );
}
