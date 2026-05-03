# @higma/fig-builder

High-level API for creating and manipulating Figma design documents. Provides `FigDesignDocument` model with CRUD operations for pages and nodes.

## API

### Create Document

```typescript
import {
  createEmptyFigDesignDocument,
  createFigDesignDocument,
} from "@higma/fig-builder";

// Create new empty document
const doc = createEmptyFigDesignDocument("My Design");

// Load from existing .fig file
const fileData = await Bun.file("design.fig").arrayBuffer();
const doc = await createFigDesignDocument(new Uint8Array(fileData));
```

### Page Operations

```typescript
import {
  addPage,
  removePage,
  reorderPage,
  duplicatePage,
  renamePage,
} from "@higma/fig-builder";

// Add page
const pageId = addPage(doc, "Page 1");

// Rename page
renamePage(doc, pageId, "New Name");

// Duplicate page
const newPageId = duplicatePage(doc, pageId);

// Reorder page (move to index 0)
reorderPage(doc, pageId, 0);

// Remove page
removePage(doc, pageId);
```

### Node Operations

```typescript
import {
  addNode,
  removeNode,
  updateNode,
  reorderNode,
  moveNodeToPage,
} from "@higma/fig-builder";

// Add frame
const nodeId = addNode(doc, pageId, {
  type: "FRAME",
  name: "Container",
  position: { x: 100, y: 100 },
  size: { width: 400, height: 300 },
  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
});

// Add rectangle inside frame
addNode(doc, nodeId, {
  type: "RECTANGLE",
  name: "Background",
  position: { x: 0, y: 0 },
  size: { width: 400, height: 300 },
  fills: [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9, a: 1 } }],
  cornerRadius: 8,
});

// Update node properties
updateNode(doc, nodeId, {
  name: "Updated Name",
  opacity: 0.8,
});

// Reorder node (z-index)
reorderNode(doc, nodeId, 0);

// Move node to another page
moveNodeToPage(doc, nodeId, otherPageId);

// Remove node
removeNode(doc, nodeId);
```

### Export

```typescript
import { exportFig } from "@higma/fig-builder";

// Export to .fig file
const result = await exportFig(doc);
await Bun.write("output.fig", result.data);

// With options
const result = await exportFig(doc, {
  compressionLevel: 9,
  reencodeSchema: true,
});
```

## Node Spec Types

```typescript
type NodeSpec = {
  type: "FRAME" | "RECTANGLE" | "ELLIPSE" | "TEXT" | "VECTOR" | ...;
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  fills?: FillSpec[];
  strokes?: StrokeSpec[];
  effects?: EffectSpec[];
  opacity?: number;
  rotation?: number;
  cornerRadius?: number | number[];
  // ... type-specific properties
};
```

## Roundtrip Support

Documents loaded from existing `.fig` files preserve the original schema for lossless roundtrip editing:

```typescript
// Load existing file
const doc = await createFigDesignDocument(fileData);

// Modify
updateNode(doc, nodeId, { name: "Modified" });

// Export preserves original schema
const result = await exportFig(doc);
```
