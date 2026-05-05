# Design

## Overview

`@higma-figma-analysis/render-outline` is a product-free analysis package. It accepts decoded fig-family `nodeChanges` values and explicit role definitions, then returns a typed `FigmaRenderOutline` that downstream renderer packages can use without importing product editors, product IO, or sibling renderers.

## Implementation Scope

- `packages/@higma-figma-analysis/render-outline/src/index.ts`
  - owns `FigmaRenderOutlineRoleDefinition`
  - owns `FigmaRenderOutlineEntry`
  - owns `FigmaRenderOutline`
  - owns `createFigmaRenderOutline`
  - owns raw guard helpers: `asRecord`, `readNodeType`, and `readName`
  - owns guid helpers: `RawGuid`, `readGuid`, `guidToString`, `readNodeGuid`, and `readParentGuid`
  - owns graph helpers: `rolesByNodeType`, `collectNodeIds`, `collectChildIds`, `collectParentIds`, and `computeDepth`

The package has no workspace dependencies. It reads only raw decoded values and fails fast when a selected render node cannot be addressed by guid.
