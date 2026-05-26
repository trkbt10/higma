/** @file Hook for resolving allowed Fig editor operations. */
import { useMemo } from "react";
import { useFigEditorSelector, type FigCreationMode, type FigEditorContextValue } from "./FigEditorContext";
import { resolveFigUserIntent } from "./fig-editor/user-intent";
import { resolveFigUserOperationDomain, type FigUserOperationDomain } from "./fig-editor/user-operation";

type FigOperationDomainSnapshot = {
  readonly mode: FigCreationMode;
  readonly textEditActive: boolean;
  readonly selectedFigNodeDragTransformActive: boolean;
};

function selectFigOperationDomainSnapshot(editor: FigEditorContextValue): FigOperationDomainSnapshot {
  return {
    mode: editor.creationMode,
    textEditActive: editor.textEdit.type === "active",
    selectedFigNodeDragTransformActive: editor.selectedFigNodeDragTransformActive,
  };
}

function sameFigOperationDomainSnapshot(
  left: FigOperationDomainSnapshot,
  right: FigOperationDomainSnapshot,
): boolean {
  return left.mode === right.mode &&
    left.textEditActive === right.textEditActive &&
    left.selectedFigNodeDragTransformActive === right.selectedFigNodeDragTransformActive;
}

/** Return the operation domain for the current editor tool. */
export function useFigOperationDomain(): FigUserOperationDomain {
  const snapshot = useFigEditorSelector(
    selectFigOperationDomainSnapshot,
    sameFigOperationDomainSnapshot,
  );
  return useMemo(
    () => resolveFigUserOperationDomain(resolveFigUserIntent({
      mode: snapshot.mode,
      textEditActive: snapshot.textEditActive,
      selectedFigNodeDragTransformActive: snapshot.selectedFigNodeDragTransformActive,
    })),
    [snapshot.mode, snapshot.selectedFigNodeDragTransformActive, snapshot.textEditActive],
  );
}
