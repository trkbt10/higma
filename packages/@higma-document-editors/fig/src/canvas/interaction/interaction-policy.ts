/** @file Interaction policy derived from the active editor tool. */
import type { FigCreationMode } from "../../context/FigEditorContext";

export type FigCanvasInteractionPolicy = {
  readonly canSelect: boolean;
  readonly canMove: boolean;
  readonly canCreate: boolean;
  readonly canEditPath: boolean;
  readonly marqueeEnabled: boolean;
};

/** Resolve canvas interaction affordances from the active Fig creation mode. */
export function resolveCanvasInteractionPolicy(mode: FigCreationMode): FigCanvasInteractionPolicy {
  if (mode === "select") {
    return {
      canSelect: true,
      canMove: true,
      canCreate: false,
      canEditPath: false,
      marqueeEnabled: true,
    };
  }
  if (mode === "pen") {
    return {
      canSelect: true,
      canMove: false,
      canCreate: false,
      canEditPath: true,
      marqueeEnabled: false,
    };
  }
  return {
    canSelect: false,
    canMove: false,
    canCreate: true,
    canEditPath: false,
    marqueeEnabled: false,
  };
}
