# @higma-document-renderers/fig

SVG and WebGL rendering for Figma nodes. Converts parsed `.fig` file data into visual output.

## Rendering Pipeline

```
FigNode[] → SceneGraph → RenderTree → SVG string / React / WebGL
```

## SVG Rendering

### renderCanvas

Render a canvas (page) to SVG. Derives dimensions from canvas children.

```typescript
import { parseFigFile } from "@higma-document-io/fig/parser";
import { buildNodeTree } from "@higma-document-models/fig/domain";
import { renderCanvas } from "@higma-document-renderers/fig/svg";

const parsed = await parseFigFile(fileData);
const { roots, nodeMap } = buildNodeTree(parsed.nodeChanges);

const doc = roots[0];
const page = doc.children?.find(c => c.type?.name === "CANVAS" && !c.internalOnly);

const result = await renderCanvas(page, {
  blobs: parsed.blobs,
  images: parsed.images,
  symbolMap: nodeMap,
});

console.log(result.svg);      // SVG string
console.log(result.warnings); // Rendering warnings
```

### renderFigToSvg

Lower-level render with explicit dimensions.

```typescript
import { renderFigToSvg } from "@higma-document-renderers/fig/svg";

const result = await renderFigToSvg(nodes, {
  width: 800,
  height: 600,
  blobs: parsed.blobs,
  images: parsed.images,
  symbolMap: nodeMap,
  backgroundColor: "#ffffff",
  normalizeRootTransform: true,
});
```

## React Rendering

React components for rendering Figma scenes.

```tsx
import { FigSceneRenderer } from "@higma-document-renderers/fig/react";

function Preview({ sceneGraph }) {
  return <FigSceneRenderer scene={sceneGraph} />;
}
```

## WebGL Rendering

Hardware-accelerated rendering for large documents.

```typescript
import { renderSceneGraphToWebGL } from "@higma-document-renderers/fig/webgl";

const canvas = document.createElement("canvas");
await renderSceneGraphToWebGL(sceneGraph, canvas, {
  width: 1920,
  height: 1080,
});
```

## Font Handling

### Node.js Font Loader

```typescript
import { createNodeFontLoader } from "@higma-document-renderers/fig/font-drivers/node";

const fontLoader = createNodeFontLoader({
  fontDirs: ["/usr/share/fonts", "./assets/fonts"],
});

const result = await renderCanvas(page, {
  ...options,
  fontLoader,
});
```

### Browser Font Loader

```typescript
import { createBrowserFontLoader } from "@higma-document-renderers/fig/font-drivers/browser";

const fontLoader = createBrowserFontLoader();
```

## Supported Node Types

| Node Type | SVG Output |
|-----------|------------|
| FRAME | `<g>` with children |
| RECTANGLE | `<rect>` or `<path>` |
| ELLIPSE | `<ellipse>` or `<path>` |
| TEXT | `<text>` or `<path>` |
| VECTOR | `<path>` |
| LINE | `<line>` |
| STAR | `<path>` |
| REGULAR_POLYGON | `<path>` |
| BOOLEAN_OPERATION | `<path>` (merged) |
| INSTANCE | Resolved from symbol |

## Supported Features

- Solid, gradient (linear/radial), and image fills
- Stroke styles (weight, align, join, cap, dashes)
- Effects (drop shadow, inner shadow, blur)
- Corner radius
- Rotation and transform
- Blend modes
- Masks and clips
- Component instances with overrides
