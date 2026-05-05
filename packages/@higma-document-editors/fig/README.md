# @higma-document-editors/fig

React-based visual editor for Figma `.fig` files. Provides a complete editing experience with canvas, panels, and tools.

## Quick Start

```tsx
import { useState } from "react";
import { FigEditor, FigEditorProvider, useFigFileLoad } from "@higma-document-editors/fig";
import type { FigDesignDocument } from "@higma-document-models/fig/domain";

function App() {
  const [document, setDocument] = useState<FigDesignDocument | null>(null);
  const { loadFromFile, isLoading, error } = useFigFileLoad();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const doc = await loadFromFile(file);
      setDocument(doc);
    }
  };

  if (!document) {
    return <input type="file" accept=".fig" onChange={handleFileChange} />;
  }

  return (
    <FigEditorProvider initialDocument={document}>
      <FigEditor />
    </FigEditorProvider>
  );
}
```

## Components

### FigEditor

Complete editor with canvas, toolbar, and panels.

```tsx
import { FigEditor } from "@higma-document-editors/fig";

<FigEditor />
```

### FigEditorProvider

Context provider for editor state.

```tsx
import { FigEditorProvider, useFigEditor } from "@higma-document-editors/fig";

<FigEditorProvider initialDocument={document}>
  <MyCustomEditor />
</FigEditorProvider>

// Access editor state in child components
function MyCustomEditor() {
  const { state, dispatch } = useFigEditor();
  // state.document, state.selection, state.activePage, etc.
}
```

### Canvas

```tsx
import { FigEditorCanvas, FigPageRenderer } from "@higma-document-editors/fig";

// Full canvas with interactions
<FigEditorCanvas />

// Just the page renderer (read-only)
<FigPageRenderer pageId={pageId} />
```

### Panels

```tsx
import {
  PropertyPanel,
  PageListPanel,
  LayerPanel,
  FigInspectorPanel,
} from "@higma-document-editors/fig";

<PropertyPanel />  // Node properties (position, size, fills, etc.)
<PageListPanel />  // Page list with thumbnails
<LayerPanel />     // Layer hierarchy
<FigInspectorPanel /> // Debug inspector
```

### Toolbar

```tsx
import { FigEditorToolbar } from "@higma-document-editors/fig";

<FigEditorToolbar />
```

## Hooks

### useFigFileLoad

Load `.fig` files from File or Uint8Array.

```tsx
import { useFigFileLoad } from "@higma-document-editors/fig";

const { loadFromFile, loadFromBuffer, isLoading, error } = useFigFileLoad();

// From File input
const doc = await loadFromFile(file);

// From ArrayBuffer
const doc = await loadFromBuffer(new Uint8Array(buffer));
```

### useExportFig

Export document to `.fig` file.

```tsx
import { useExportFig } from "@higma-document-editors/fig";

const { exportToFile, exportToBlob, isExporting } = useExportFig();

// Download as file
await exportToFile("design.fig");

// Get as Blob
const blob = await exportToBlob();
```

### useFigEditor

Access editor state and dispatch actions.

```tsx
import { useFigEditor } from "@higma-document-editors/fig";

const { state, dispatch } = useFigEditor();

// Read state
const selectedNodes = state.selection.ids;
const activePage = state.activePage;
const document = state.document;

// Dispatch actions
dispatch({ type: "SELECT_NODE", nodeId });
dispatch({ type: "UPDATE_NODE", nodeId, changes: { name: "New Name" } });
dispatch({ type: "SET_ACTIVE_PAGE", pageId });
```

## Supported Operations

- Node selection (single, multi, marquee)
- Move, resize, rotate nodes
- Create shapes (rectangle, ellipse, text, frame)
- Edit fills, strokes, effects
- Text editing
- Page management
- Undo/redo
- Copy/paste
- Component instances
- Boolean operations
- Export to SVG/PNG
