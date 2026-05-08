<p align="center">
  <img src="brand/higma.svg" alt="higma logo" width="180" />
</p>

<h1 align="center">higma</h1>

A TypeScript toolkit for programmatically reading, writing, rendering, and editing Figma `.fig` files.

higma provides a full-stack implementation of the Figma file format (fig-kiwi). From parsing and building to SVG rendering and a React-based visual editor, it covers everything needed to work with `.fig` files programmatically.

```
.fig file
    ↓ parse
NodeChanges + Blobs (Figma document structure)
    ↓ render
SVG string
    ↓ edit
FigEditor (React component)
    ↓ export
.fig file
```


## Packages

| Package | Description |
|---------|-------------|
| [@higma/fig](packages/@higma/fig/) | Parser and builder for .fig files. Kiwi schema encoding/decoding |
| [@higma/fig-builder](packages/@higma/fig-builder/) | High-level API. FigDesignDocument model with CRUD operations |
| [@higma/fig-renderer](packages/@higma/fig-renderer/) | SVG rendering for Figma nodes |
| [@higma/fig-editor](packages/@higma/fig-editor/) | React-based visual editor |
| [@higma/editor-core](packages/@higma/editor-core/) | Editor primitives (selection, history, drag, geometry) |
| [@higma/editor-controls](packages/@higma/editor-controls/) | Editor UI controls |
| [@higma/ui-components](packages/@higma/ui-components/) | Shared UI components (buttons, icons, panels, etc.) |
| [@higma/buffer](packages/@higma/buffer/) | Buffer utilities (base64, DataURL) |
| [@higma/png](packages/@higma/png/) | PNG encoding/decoding |
| [@higma/zip](packages/@higma/zip/) | ZIP file handling (.fig files are ZIP archives) |

## Usage

### Parse a .fig file

```typescript
import { parseFigFile, buildNodeTree } from "@higma-document-models/fig/parser";

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
} from "@higma-document-io/fig";

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
import { parseFigFile, buildNodeTree } from "@higma-document-models/fig/parser";
import { renderCanvas } from "@higma-document-renderers/fig/svg";

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
import { FigEditor, FigEditorProvider, useFigFileLoad } from "@higma-document-editors/fig";
import type { FigDesignDocument } from "@higma-document-models/fig/domain";

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


## Development

```bash
# Install dependencies
bun install

# Lint
bun run lint

# Type check
bun run typecheck

# Test
bun run test
```


## .fig File Format

A `.fig` file is a **ZIP archive** containing:

| File | Required | Description |
|------|----------|-------------|
| `canvas.fig` | Yes | Main data (fig-kiwi format) |
| `meta.json` | Yes | Metadata (filename, background color, etc.) |
| `thumbnail.png` | Yes | Thumbnail image |
| `images/*` | No | Embedded images |

`canvas.fig` contains Deflate/Zstd compressed data encoded in Kiwi schema format. See [@higma-document-models/fig README](packages/@higma-document-models/fig/README.md) for details.

Figma-adjacent packages such as `.deck`, `.buzz`, and `.site` reuse the same ZIP shape and raw canvas chunk layout while changing the `canvas.fig` magic and domain schema usage. See [Fig-Adjacent Formats](fig-adjacent-formats.md) for the observed differences and package boundary notes.

### Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (ES Modules)
- **UI**: React 19
- **Test**: Vitest
- **Lint**: ESLint


## License

Private
