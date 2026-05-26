/** @file Fig editor toolbar. */
import type { CSSProperties, ReactNode } from "react";
import { ToolbarButton, ToolbarSeparator } from "@higma-editor-kernel/ui/primitives";
import {
  DeleteIcon,
  DiamondIcon,
  DownloadIcon,
  EllipseIcon,
  FrameIcon,
  LineIcon,
  PenIcon,
  RedoIcon,
  RectIcon,
  SelectIcon,
  StarIcon,
  TextBoxIcon,
  UndoIcon,
} from "@higma-editor-kernel/ui/icons";
import {
  FIG_NODE_MUTATION_SOURCE,
  useFigEditorSelector,
  type FigCreationMode,
  type FigEditorContextValue,
} from "../context/FigEditorContext";
import { useExportFig } from "../hooks/use-export-fig";

type ToolButtonSpec = {
  readonly mode: FigCreationMode;
  readonly label: string;
  readonly icon: ReactNode;
};

type FigEditorToolbarSnapshot = {
  readonly creationMode: FigCreationMode;
  readonly selectedGuidCount: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly setCreationMode: FigEditorContextValue["setCreationMode"];
  readonly undo: FigEditorContextValue["undo"];
  readonly redo: FigEditorContextValue["redo"];
  readonly deleteSelectedNodes: FigEditorContextValue["deleteSelectedNodes"];
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 2,
  width: "100%",
};

const exportStatusStyle: CSSProperties = {
  color: "#536174",
  fontSize: 11,
  marginLeft: 4,
  maxWidth: 180,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const toolButtons: readonly ToolButtonSpec[] = [
  { mode: "select", label: "Select (V)", icon: <SelectIcon size={16} aria-hidden={false} /> },
  { mode: "frame", label: "Frame", icon: <FrameIcon size={16} aria-hidden={false} /> },
  { mode: "rectangle", label: "Rectangle", icon: <RectIcon size={16} aria-hidden={false} /> },
  { mode: "ellipse", label: "Ellipse", icon: <EllipseIcon size={16} aria-hidden={false} /> },
  { mode: "line", label: "Line", icon: <LineIcon size={16} aria-hidden={false} /> },
  { mode: "star", label: "Star", icon: <StarIcon size={16} aria-hidden={false} /> },
  { mode: "polygon", label: "Polygon", icon: <DiamondIcon size={16} aria-hidden={false} /> },
  { mode: "text", label: "Text", icon: <TextBoxIcon size={16} aria-hidden={false} /> },
  { mode: "pen", label: "Vector Edit (P)", icon: <PenIcon size={16} aria-hidden={false} /> },
];

function formatExportStatus(size: number | undefined): string | undefined {
  if (size === undefined) {
    return undefined;
  }
  return `Exported ${size.toLocaleString()} bytes`;
}

function selectFigEditorToolbarSnapshot(editor: FigEditorContextValue): FigEditorToolbarSnapshot {
  return {
    creationMode: editor.creationMode,
    selectedGuidCount: editor.selectedGuids.length,
    canUndo: editor.canUndo,
    canRedo: editor.canRedo,
    setCreationMode: editor.setCreationMode,
    undo: editor.undo,
    redo: editor.redo,
    deleteSelectedNodes: editor.deleteSelectedNodes,
  };
}

function sameFigEditorToolbarSnapshot(
  left: FigEditorToolbarSnapshot,
  right: FigEditorToolbarSnapshot,
): boolean {
  return left.creationMode === right.creationMode &&
    left.selectedGuidCount === right.selectedGuidCount &&
    left.canUndo === right.canUndo &&
    left.canRedo === right.canRedo &&
    left.setCreationMode === right.setCreationMode &&
    left.undo === right.undo &&
    left.redo === right.redo &&
    left.deleteSelectedNodes === right.deleteSelectedNodes;
}

/** Render creation and selection tools for the Fig editor. */
export function FigEditorToolbar() {
  const {
    creationMode,
    setCreationMode,
    selectedGuidCount,
    canUndo,
    canRedo,
    undo,
    redo,
    deleteSelectedNodes,
  } = useFigEditorSelector(
    selectFigEditorToolbarSnapshot,
    sameFigEditorToolbarSnapshot,
  );
  const { downloadContext, isExporting, lastResult, error } = useExportFig();
  const exportStatus = error?.message ?? formatExportStatus(lastResult?.size);
  return (
    <div style={toolbarStyle}>
      {toolButtons.map((button) => (
        <ToolbarButton
          key={button.mode}
          icon={button.icon}
          label={button.label}
          active={creationMode === button.mode}
          onClick={() => setCreationMode(button.mode)}
          size="md"
        />
      ))}
      <ToolbarSeparator />
      <ToolbarButton
        icon={<UndoIcon size={16} aria-hidden={false} />}
        label="Undo"
        disabled={!canUndo}
        onClick={undo}
        size="md"
      />
      <ToolbarButton
        icon={<RedoIcon size={16} aria-hidden={false} />}
        label="Redo"
        disabled={!canRedo}
        onClick={redo}
        size="md"
      />
      <ToolbarSeparator />
      <ToolbarButton
        icon={<DeleteIcon size={16} aria-hidden={false} />}
        label="Delete"
        disabled={selectedGuidCount === 0}
        onClick={() => deleteSelectedNodes(FIG_NODE_MUTATION_SOURCE.toolbar)}
        size="md"
      />
      <ToolbarSeparator />
      <ToolbarButton
        icon={<DownloadIcon size={16} aria-hidden={false} />}
        label="Export .fig"
        disabled={isExporting}
        onClick={() => {
          void downloadContext({ document, url: URL });
        }}
        size="md"
      />
      {exportStatus && <span aria-live="polite" style={exportStatusStyle}>{exportStatus}</span>}
    </div>
  );
}
