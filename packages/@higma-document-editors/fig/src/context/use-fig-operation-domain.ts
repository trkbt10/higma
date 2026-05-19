/** @file Hook for resolving allowed Fig editor operations. */
import { useMemo } from "react";
import { useFigEditor } from "./FigEditorContext";
import { resolveFigUserIntent } from "./fig-editor/user-intent";
import { resolveFigUserOperationDomain, type FigUserOperationDomain } from "./fig-editor/user-operation";

/** Return the operation domain for the current editor tool. */
export function useFigOperationDomain(): FigUserOperationDomain {
  const { creationMode, textEdit, canvasTransformActive } = useFigEditor();
  return useMemo(
    () => resolveFigUserOperationDomain(resolveFigUserIntent({
      mode: creationMode,
      textEditActive: textEdit.type === "active",
      canvasTransformActive,
    })),
    [canvasTransformActive, creationMode, textEdit.type],
  );
}
