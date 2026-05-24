/** @file Hook for resolving allowed Fig editor operations. */
import { useMemo } from "react";
import { useFigEditor } from "./FigEditorContext";
import { resolveFigUserIntent } from "./fig-editor/user-intent";
import { resolveFigUserOperationDomain, type FigUserOperationDomain } from "./fig-editor/user-operation";

/** Return the operation domain for the current editor tool. */
export function useFigOperationDomain(): FigUserOperationDomain {
  const { creationMode, textEdit, selectedFigNodeDragTransformActive } = useFigEditor();
  return useMemo(
    () => resolveFigUserOperationDomain(resolveFigUserIntent({
      mode: creationMode,
      textEditActive: textEdit.type === "active",
      selectedFigNodeDragTransformActive,
    })),
    [creationMode, selectedFigNodeDragTransformActive, textEdit.type],
  );
}
