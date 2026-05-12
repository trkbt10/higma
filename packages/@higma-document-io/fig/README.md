# @higma-document-io/fig

High-level API for creating and manipulating Figma design documents. Provides `FigDesignDocument` model with CRUD operations for pages and nodes.

All builder operations are **immutable** — each call returns a new
`FigDesignDocument` so the original is untouched. ID allocation is
delegated to a caller-owned `FigBuilderState`. After Phase 0b/0c of the
SoT consolidation refactor, this is the only public construction
surface; the legacy `createFigFile()` / `frameNode()` / `textNode()`
fluent builders are gone.

## API

### Create Document

```typescript
import {
  createEmptyFigDesignDocument,
  createFigBuilderState,
  createFigDesignDocument,
} from "@higma-document-io/fig";

// Create a new empty document (one blank page).
const doc = createEmptyFigDesignDocument("My Design");
const state = createFigBuilderState({
  nodeIdCounter: { sessionID: 1, nextLocalID: 100 },
  pageIdCounter: { sessionID: 0, nextLocalID: 2 },
});

// Or load from an existing .fig file.
const fileData = await Bun.file("design.fig").arrayBuffer();
const loaded = await createFigDesignDocument(new Uint8Array(fileData));
```

### Page Operations

```typescript
import {
  addPage,
  removePage,
  reorderPage,
  duplicatePage,
  renamePage,
} from "@higma-document-io/fig";

// Add page (returns a new doc + the assigned FigPageId).
const r = addPage({ state, doc, name: "Page 2" });
const newDoc = r.doc;
const pageId = r.pageId;

// Internal Only Canvas (load-bearing for Figma import).
const docWithInternal = addPage({
  state,
  doc: newDoc,
  name: "Internal Only Canvas",
  internalOnly: true,
}).doc;

// Mutation helpers (all return new documents).
const renamedDoc = renamePage(docWithInternal, pageId, "New Name");
const duplicated = duplicatePage(renamedDoc, pageId);
const reordered = reorderPage(duplicated.doc, pageId, 0);
const removed = removePage(reordered, pageId);
```

### Node Operations

```typescript
import {
  addNode,
  removeNode,
  updateNode,
  reorderNode,
  moveNodeToPage,
} from "@higma-document-io/fig";

const pageId = doc.pages[0]!.id;

// Add a top-level FRAME (parentId = null means "page child").
const r1 = addNode({
  state,
  doc,
  pageId,
  parentId: null,
  spec: {
    type: "FRAME",
    name: "Container",
    x: 100,
    y: 100,
    width: 400,
    height: 300,
    fills: [{
      type: "SOLID",
      color: { r: 1, g: 1, b: 1, a: 1 },
      opacity: 1,
      visible: true,
      blendMode: "NORMAL",
    }],
  },
});

// Add a child of that frame.
const r2 = addNode({
  state,
  doc: r1.doc,
  pageId,
  parentId: r1.nodeId,
  spec: {
    type: "ROUNDED_RECTANGLE",
    name: "Background",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    cornerRadius: 8,
    fills: [{
      type: "SOLID",
      color: { r: 0.9, g: 0.9, b: 0.9, a: 1 },
      opacity: 1,
      visible: true,
      blendMode: "NORMAL",
    }],
  },
});

// Update node properties (FigDesignNode mutator).
const updated = updateNode({
  doc: r2.doc,
  pageId,
  nodeId: r2.nodeId,
  updater: (node) => ({ ...node, opacity: 0.8 }),
});

// Reorder z-index (front / back / forward / backward).
const reordered = reorderNode({ doc: updated, pageId, nodeId: r2.nodeId, direction: "front" });

// Move between pages.
const moved = moveNodeToPage({ doc: reordered, fromPageId: pageId, toPageId: otherPageId, nodeId: r2.nodeId });

// Remove.
const final = removeNode(moved, pageId, r2.nodeId);
```

### Export

```typescript
import { exportFig } from "@higma-document-io/fig";

// Export to .fig binary. The pipeline auto-synthesises load-bearing
// fields (fillGeometry blobs, meta.json, thumbnail.png, canvas
// version "e", isSymbolPublishable on SYMBOL, etc.) so consumers only
// have to provide semantic node specs.
const result = await exportFig(doc);
await Bun.write("output.fig", result.data);

// With options.
const result = await exportFig(doc, {
  compressionLevel: 9,
  reencodeSchema: true,
});
```

### Image Registration

```typescript
import { addImage } from "@higma-document-models/fig/builder";

// SHA-1 of the bytes is the canonical image ref (Figma's convention).
const sha1 = await computeSha1Hex(pngBytes);
const docWithImage = addImage(doc, sha1, {
  ref: sha1,
  data: pngBytes,
  mimeType: "image/png",
});

// Reference from an IMAGE paint.
const paint: FigPaint = {
  type: "IMAGE",
  imageRef: sha1,
  imageHash: sha1,
  imageScaleMode: "FILL",
  scaleMode: "FILL",
  opacity: 1,
  visible: true,
  blendMode: "NORMAL",
};
```

## Node Spec Types

```typescript
type BaseNodeSpec = {
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  fills?: readonly FigPaint[];
  strokes?: readonly FigPaint[];
  strokeWeight?: number;
  effects?: readonly FigEffect[];
  opacity?: number;
  visible?: boolean;
  layoutConstraints?: LayoutConstraints;
};

type NodeSpec =
  | (BaseNodeSpec & { type: "FRAME"; clipsContent?: boolean; autoLayout?: AutoLayoutProps; cornerRadius?: number; ... })
  | (BaseNodeSpec & { type: "RECTANGLE" })
  | (BaseNodeSpec & { type: "ROUNDED_RECTANGLE"; cornerRadius?: number; rectangleCornerRadii?: ... })
  | (BaseNodeSpec & { type: "ELLIPSE" })
  | (BaseNodeSpec & { type: "LINE" })
  | (BaseNodeSpec & { type: "STAR"; pointCount?: number; starInnerRadius?: number })
  | (BaseNodeSpec & { type: "REGULAR_POLYGON"; pointCount?: number })
  | (BaseNodeSpec & { type: "VECTOR"; vectorPaths?: ... })
  | (BaseNodeSpec & { type: "GROUP" })
  | (BaseNodeSpec & { type: "SECTION" })
  | (BaseNodeSpec & { type: "BOOLEAN_OPERATION"; booleanOperation: KiwiEnumValue })
  | (BaseNodeSpec & { type: "TEXT"; characters: string; fontSize?: number; fontFamily?: string; ... })
  | (BaseNodeSpec & { type: "SYMBOL"; clipsContent?: boolean; autoLayout?: AutoLayoutProps })
  | (BaseNodeSpec & { type: "INSTANCE"; symbolId: FigNodeId });
```

For niche `FigDesignNode` fields not surfaced through `NodeSpec`
(`minSize`, `maxSize`, `bordersTakeSpace`, `targetAspectRatio`,
`exportSettings`, `strokeDashes`, `strokeCap`, `arcData`,
`textData.styleOverrideTable`, etc.), use `updateNode` after `addNode`
to set them directly on the `FigDesignNode`.

## Roundtrip Support

Documents loaded from existing `.fig` files preserve the original
schema for lossless roundtrip editing:

```typescript
const doc = await createFigDesignDocument(fileData);
const state = createFigBuilderStateFromDocument({
  document: doc,
  nodeSessionID: 2,
  pageSessionID: 0,
  minimumNodeLocalID: 1,
  minimumPageLocalID: 1,
});

// Modify.
const next = updateNode({
  doc,
  pageId: doc.pages[0]!.id,
  nodeId: someId,
  updater: (n) => ({ ...n, name: "Modified" }),
});

// Export preserves the original schema (roundtrip path).
const result = await exportFig(next);
```
