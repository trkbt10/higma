/** @file Resolve editor user intent from the active Kiwi editor tool. */
import type { FigCreationMode } from "../FigEditorContext";

export type FigUserIntentKind =
  | "select"
  | "create"
  | "path-edit"
  | "text-edit"
  | "selected-fig-node-drag-transform";

export type FigUserIntent = {
  readonly kind: FigUserIntentKind;
  readonly mode: FigCreationMode;
};

export type FigUserIntentInput = {
  readonly mode: FigCreationMode;
  readonly textEditActive?: boolean;
  readonly selectedFigNodeDragTransformActive?: boolean;
};

/** Resolve the current user intent. */
export function resolveFigUserIntent(input: FigCreationMode | FigUserIntentInput): FigUserIntent {
  if (typeof input === "string") {
    return resolveFigUserIntentFromFields({
      mode: input,
      textEditActive: false,
      selectedFigNodeDragTransformActive: false,
    });
  }
  return resolveFigUserIntentFromFields({
    mode: input.mode,
    textEditActive: input.textEditActive === true,
    selectedFigNodeDragTransformActive: input.selectedFigNodeDragTransformActive === true,
  });
}

function resolveFigUserIntentFromFields(
  input: Required<FigUserIntentInput>,
): FigUserIntent {
  const { mode, textEditActive, selectedFigNodeDragTransformActive } = input;
  if (textEditActive) {
    return { kind: "text-edit", mode };
  }
  if (selectedFigNodeDragTransformActive) {
    return { kind: "selected-fig-node-drag-transform", mode };
  }
  if (mode === "select") {
    return { kind: "select", mode };
  }
  if (mode === "pen") {
    return { kind: "path-edit", mode };
  }
  return { kind: "create", mode };
}
