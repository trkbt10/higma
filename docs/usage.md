## Usage

### Parse a .fig file

```typescript
import { parseFigFile, buildNodeTree } from "@higma/fig/parser";

const fileData = await Bun.file("design.fig").arrayBuffer();
const parsed = await parseFigFile(new Uint8Array(fileData));

// Build a navigable tree structure
const { roots, nodeMap } = buildNodeTree(parsed.nodeChanges);

// Traverse the document (first root is typically the DOCUMENT node)
const doc = roots[0];
for (const page of doc.children ?? []) {
  if (page.internalOnly) continue; // skip internal canvas
  console.log("Page:", page.name);
  for (const node of page.children ?? []) {
    console.log("  -", node.type?.name, node.name);
  }
}
```

### Build a .fig file programmatically

```typescript
import {
  createEmptyFigDesignDocument,
  addPage,
  addNode,
  exportFig,
} from "@higma/fig-builder";

// Create a new document
const doc = createEmptyFigDesignDocument("My Design");
const pageId = addPage(doc, "Page 1");

// Add a frame
addNode(doc, pageId, {
  type: "FRAME",
  name: "Container",
  position: { x: 100, y: 100 },
  size: { width: 400, height: 300 },
  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
});

// Export to .fig
const result = await exportFig(doc);
await Bun.write("output.fig", result.data);
```

### Render to SVG

```typescript
import { parseFigFile, buildNodeTree } from "@higma/fig/parser";
import { renderCanvas } from "@higma/fig-renderer/svg";

const parsed = await parseFigFile(fileData);
const { roots, nodeMap } = buildNodeTree(parsed.nodeChanges);

// Find the first page (canvas)
const doc = roots[0];
const page = doc.children?.find(c => c.type?.name === "CANVAS" && !c.internalOnly);

if (page) {
  const result = await renderCanvas(page, {
    blobs: parsed.blobs,
    images: parsed.images,
    symbolMap: nodeMap,
  });

  console.log(result.svg);
}
```

### React Editor

```tsx
import { useState } from "react";
import { FigEditor, FigEditorProvider, useFigFileLoad } from "@higma/fig-editor";
import type { FigDesignDocument } from "@higma/fig/domain";

function App() {
  const [document, setDocument] = useState<FigDesignDocument | null>(null);
  const { loadFromFile } = useFigFileLoad();

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
