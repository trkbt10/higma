/**
 * @file @higma-editor-kernel/core public exports
 */

export type { UndoRedoHistory } from "./history";
export {
  canRedo,
  canUndo,
  clearHistory,
  createHistory,
  pushHistory,
  redoCount,
  redoHistory,
  replacePresent,
  undoCount,
  undoHistory,
} from "./history";

export type { SelectionPrimaryFallback, SelectionState } from "./selection";
export {
  addToSelection,
  createEmptySelection,
  createMultiSelection,
  createSingleSelection,
  isSelected,
  isSelectionEmpty,
  removeFromSelection,
  toggleSelection,
} from "./selection";

export type { ClipboardContent } from "./clipboard";
export { createClipboardContent, incrementPasteCount, markAsCopy, markAsCut } from "./clipboard";

export type {
  IdleDragState,
  PreviewDelta,
  MoveDragState,
  ResizeDragState,
  RotateDragState,
  CreateDragState,
  MarqueeDragState,
  PendingMoveDragState,
  PendingResizeDragState,
  PendingRotateDragState,
  DragState,
} from "./drag-state";
export {
  createIdleDragState,
  isDragIdle,
  isDragMove,
  isDragResize,
  isDragRotate,
  isDragCreate,
  isDragMarquee,
  isDragPendingMove,
  isDragPendingResize,
  isDragPendingRotate,
  isDragPending,
} from "./drag-state";

export { DRAG_THRESHOLD_PX, isDragThresholdExceeded } from "./drag-utils";

export type { PrimaryMouseEventLike, PrimaryPointerEventLike, TextareaSelectionLike } from "./pointer-utils";
export { applySelectionRange, getSelectionAnchor, isPrimaryMouseAction, isPrimaryPointerAction } from "./pointer-utils";

// Geometry — re-exported through the geometry submodule's own index.
export type {
  Point,
  SimpleBounds,
  RotatedBoundsInput,
  RotationResult,
  ResizeHandlePosition,
  ResizeBounds,
  ResizeOptions,
  MoveDragPreviewInput,
  ResizeDragPreviewInput,
  RotateDragPreviewInput,
} from "./geometry";

export {
  normalizeAngle,
  degreesToRadians,
  radiansToDegrees,
  calculateAngleFromCenter,
  DEFAULT_SNAP_ANGLES,
  DEFAULT_SNAP_THRESHOLD,
  snapAngle,
  rotatePointAroundCenter,
  calculateShapeCenter,
  getRotatedCorners,
  getSvgRotationTransform,
  getSvgRotationTransformForBounds,
  rotateShapeAroundCenter,
  calculateRotationDelta,
  calculateAspectDelta,
  applyMinConstraints,
  resizeFromNW,
  resizeFromN,
  resizeFromNE,
  resizeFromE,
  resizeFromSE,
  resizeFromS,
  resizeFromSW,
  resizeFromW,
  calculateResizeBounds,
  calculateScaleFactors,
  calculateRelativePosition,
  calculateMultiResizeBounds,
  getCombinedBoundsWithRotation,
  clientToCanvasCoords,
  calculateResizedDimensions,
  applyMovePreview,
  applyResizePreview,
  applyRotatePreview,
  applyDragPreview,
} from "./geometry";

// Adapter data types (SoT)
export type {
  TextStyle,
  FontData,
  FontMetricsData,
  CaseTransformData,
  TextJustifyData,
  ParagraphSpacingData,
  IndentData,
  ListData,
  PositionData,
  SizeData,
} from "./adapter-types";

// Inspector types (SoT)
export type {
  NodeCategoryConfig,
  NodeCategoryRegistry,
  AffineTransform,
  InspectorBoxInfo,
  InspectorTreeNode,
} from "./inspector-types";
export {
  IDENTITY_TRANSFORM,
  resolveNodeColor,
  resolveNodeLabel,
  affineToSvgTransform,
} from "./inspector-types";
