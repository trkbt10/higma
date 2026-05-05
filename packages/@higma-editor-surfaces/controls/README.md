# @higma-editor-surfaces/controls

React UI controls for visual editors. Includes text/table formatting, zoom controls, canvas selection handles, and inspector overlays.

## Components

### Text Formatting

```tsx
import { TextFormattingEditor, ParagraphFormattingEditor } from "@higma-editor-surfaces/controls";

<TextFormattingEditor
  value={textFormatting}
  onChange={handleChange}
  features={{ bold: true, italic: true, underline: true, fontSize: true }}
/>

<ParagraphFormattingEditor
  value={paragraphFormatting}
  onChange={handleChange}
  features={{ alignment: true, lineHeight: true, spacing: true }}
/>
```

### Font Family Select

Font selector with system font detection.

```tsx
import { FontFamilySelect, useDocumentFontFamilies } from "@higma-editor-surfaces/controls";

function FontSelector({ value, onChange }) {
  const fonts = useDocumentFontFamilies();
  
  return (
    <FontFamilySelect
      value={value}
      onChange={onChange}
      fonts={fonts}
    />
  );
}
```

### Zoom Controls

```tsx
import { ZoomControls, ZOOM_STEPS, getNextZoomValue } from "@higma-editor-surfaces/controls";

<ZoomControls
  value={zoom}
  onChange={setZoom}
  onFitToScreen={handleFitToScreen}
/>

// Programmatic zoom
const nextZoom = getNextZoomValue(currentZoom, "in");
```

### Editor Shell

Responsive 3-panel layout with toolbar.

```tsx
import { EditorShell, CanvasArea } from "@higma-editor-surfaces/controls";

<EditorShell
  toolbar={<Toolbar />}
  leftPanel={<LayerPanel />}
  rightPanel={<PropertyPanel />}
  breakpoints={{ mobile: 640, tablet: 1024 }}
>
  <CanvasArea>
    <Canvas />
  </CanvasArea>
</EditorShell>
```

### Canvas Selection

Selection box and handles for canvas objects.

```tsx
import {
  SelectionBox,
  CanvasResizeHandle,
  CanvasRotateHandle,
} from "@higma-editor-surfaces/controls";

<SelectionBox
  bounds={bounds}
  rotation={rotation}
  variant="single" // "single" | "multi"
/>

<CanvasResizeHandle
  position="se"
  onDragStart={handleResizeStart}
  onDrag={handleResize}
  onDragEnd={handleResizeEnd}
/>

<CanvasRotateHandle
  onDragStart={handleRotateStart}
  onDrag={handleRotate}
  onDragEnd={handleRotateEnd}
/>
```

### Inspector Overlays

Visualize node structure and bounding boxes.

```tsx
import {
  BoundingBoxOverlay,
  InspectorTreePanel,
  CategoryLegend,
  NodeTooltip,
} from "@higma-editor-surfaces/controls";

<BoundingBoxOverlay
  boxes={inspectorBoxes}
  hoveredId={hoveredNodeId}
  selectedIds={selectedNodeIds}
/>

<InspectorTreePanel
  tree={inspectorTree}
  onNodeHover={setHoveredNodeId}
  onNodeSelect={handleNodeSelect}
/>
```

## Types

### TextFormatting

```typescript
type TextFormatting = {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
};
```

### ZoomMode

```typescript
type ZoomMode = "fit" | number;
```
