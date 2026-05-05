# @higma-editor-kernel/core

Core editor primitives for selection, history (undo/redo), drag state, and geometry calculations. Framework-agnostic building blocks for visual editors.

## Modules

### History (Undo/Redo)

Immutable history state with undo/redo support.

```typescript
import {
  createHistory,
  pushHistory,
  undoHistory,
  redoHistory,
  canUndo,
  canRedo,
} from "@higma-editor-kernel/core";

let history = createHistory(initialState);

// Push new state
history = pushHistory(history, newState);

// Undo/Redo
if (canUndo(history)) {
  history = undoHistory(history);
}
if (canRedo(history)) {
  history = redoHistory(history);
}

// Access current state
const current = history.present;
```

### Selection

Multi-selection state management.

```typescript
import {
  createEmptySelection,
  createSingleSelection,
  createMultiSelection,
  addToSelection,
  removeFromSelection,
  toggleSelection,
  isSelected,
  isSelectionEmpty,
} from "@higma-editor-kernel/core";

let selection = createEmptySelection();

// Select single item
selection = createSingleSelection("node-1");

// Multi-select
selection = createMultiSelection(["node-1", "node-2", "node-3"]);

// Toggle selection (Cmd/Ctrl+click)
selection = toggleSelection(selection, "node-2");

// Check selection
isSelected(selection, "node-1"); // true
isSelectionEmpty(selection);     // false
```

### Drag State

State machine for drag operations (move, resize, rotate, create, marquee).

```typescript
import {
  createIdleDragState,
  isDragIdle,
  isDragMove,
  isDragResize,
  isDragRotate,
  isDragPending,
  DRAG_THRESHOLD_PX,
} from "@higma-editor-kernel/core";

let drag = createIdleDragState();

// Check drag state
if (isDragIdle(drag)) { /* waiting for drag */ }
if (isDragPending(drag)) { /* mouse down, waiting for threshold */ }
if (isDragMove(drag)) { /* moving nodes */ }
if (isDragResize(drag)) { /* resizing nodes */ }
if (isDragRotate(drag)) { /* rotating nodes */ }
```

### Geometry

Calculations for rotation, resize, bounds, and coordinate transforms.

```typescript
import {
  degreesToRadians,
  radiansToDegrees,
  normalizeAngle,
  rotatePointAroundCenter,
  calculateShapeCenter,
  calculateResizeBounds,
  getCombinedBoundsWithRotation,
  clientToCanvasCoords,
} from "@higma-editor-kernel/core";

// Rotation
const radians = degreesToRadians(45);
const center = calculateShapeCenter(bounds);
const rotated = rotatePointAroundCenter(point, center, radians);

// Resize from corner handle
const newBounds = calculateResizeBounds(
  originalBounds,
  "se", // handle position: nw, n, ne, e, se, s, sw, w
  deltaX,
  deltaY,
  { maintainAspect: true },
);

// Combined bounds of multiple rotated shapes
const combined = getCombinedBoundsWithRotation(shapes);

// Client coords to canvas coords
const canvasPoint = clientToCanvasCoords(clientX, clientY, viewport);
```

## Types

### Point / SimpleBounds

```typescript
type Point = { x: number; y: number };

type SimpleBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
```

### SelectionState

```typescript
type SelectionState<T = string> = {
  readonly ids: ReadonlySet<T>;
  readonly primary: T | null;
};
```

### DragState

```typescript
type DragState =
  | IdleDragState
  | PendingMoveDragState
  | PendingResizeDragState
  | PendingRotateDragState
  | MoveDragState
  | ResizeDragState
  | RotateDragState
  | CreateDragState
  | MarqueeDragState;
```
