/** @file Keyboard bindings for the Kiwi Fig editor. */
import { useEffect } from "react";
import { isInputTarget } from "@higma-editor-kernel/core/keyboard";
import type { FigCreationMode } from "../../context/FigEditorContext";

export type UseFigKeyboardOptions = {
  readonly hasSelection: boolean;
  readonly setCreationMode: (mode: FigCreationMode) => void;
  readonly deleteSelection: () => void;
  readonly clearSelection: () => void;
  readonly vectorPathDraftActive: boolean;
  readonly commitVectorPathDraft: (nextMode: FigCreationMode) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly isTextEditing: boolean;
  readonly exitTextEdit: () => void;
};

/** Attach document-level keyboard shortcuts while the editor canvas is mounted. */
export function useFigKeyboard({
  hasSelection,
  setCreationMode,
  deleteSelection,
  clearSelection,
  vectorPathDraftActive,
  commitVectorPathDraft,
  canUndo,
  canRedo,
  undo,
  redo,
  isTextEditing,
  exitTextEdit,
}: UseFigKeyboardOptions): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isInputTarget(event.target)) {
        return;
      }
      if (event.defaultPrevented) {
        return;
      }
      const key = event.key.toLowerCase();
      const isMod = event.metaKey || event.ctrlKey;
      if (isTextEditing && event.key !== "Escape") {
        return;
      }
      if (isTextEditing) {
        event.preventDefault();
        exitTextEdit();
        return;
      }
      if (isMod && key === "z" && !event.shiftKey && canUndo) {
        event.preventDefault();
        undo();
        return;
      }
      if (isMod && key === "z" && event.shiftKey && canRedo) {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === "Enter" && vectorPathDraftActive) {
        event.preventDefault();
        commitVectorPathDraft("pen");
        return;
      }
      if (key === "delete" && hasSelection) {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (key === "backspace" && hasSelection) {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (key === "escape" && vectorPathDraftActive) {
        event.preventDefault();
        commitVectorPathDraft("select");
        return;
      }
      if (key === "escape") {
        event.preventDefault();
        setCreationMode("select");
        clearSelection();
        return;
      }
      if (isMod || event.altKey) {
        return;
      }
      if (key === "v") {
        setCreationMode("select");
        return;
      }
      if (key === "p") {
        setCreationMode("pen");
        return;
      }
      if (key === "f") {
        setCreationMode("frame");
        return;
      }
      if (key === "r") {
        setCreationMode("rectangle");
        return;
      }
      if (key === "o") {
        setCreationMode("ellipse");
        return;
      }
      if (key === "l") {
        setCreationMode("line");
        return;
      }
      if (key === "t") {
        setCreationMode("text");
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    canRedo,
    canUndo,
    clearSelection,
    commitVectorPathDraft,
    deleteSelection,
    exitTextEdit,
    hasSelection,
    isTextEditing,
    redo,
    setCreationMode,
    undo,
    vectorPathDraftActive,
  ]);
}
