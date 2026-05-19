/** @file Resolve editor user intent from the active Kiwi editor tool. */
import type { FigCreationMode } from "../FigEditorContext";

export type FigUserIntentKind = "select" | "create" | "path-edit" | "text-edit" | "transform";

export type FigUserIntent = {
  readonly kind: FigUserIntentKind;
  readonly mode: FigCreationMode;
};

export type FigUserIntentInput = {
  readonly mode: FigCreationMode;
  readonly textEditActive?: boolean;
  readonly canvasTransformActive?: boolean;
};

/** Resolve the current user intent. */
export function resolveFigUserIntent(input: FigCreationMode | FigUserIntentInput): FigUserIntent {
  const mode = typeof input === "string" ? input : input.mode;
  const textEditActive = typeof input === "string" ? false : input.textEditActive === true;
  const canvasTransformActive = typeof input === "string" ? false : input.canvasTransformActive === true;
  if (textEditActive) {
    return { kind: "text-edit", mode };
  }
  if (canvasTransformActive) {
    return { kind: "transform", mode };
  }
  if (mode === "select") {
    return { kind: "select", mode };
  }
  if (mode === "pen") {
    return { kind: "path-edit", mode };
  }
  return { kind: "create", mode };
}
