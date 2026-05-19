# @higma-document-models/fig

Domain types and resolvers for Figma `.fig` Kiwi documents.

The Kiwi `nodeChanges` document is the source of truth. This package
does not define a second design-document model. Consumers should index
`nodeChanges` with `indexFigKiwiDocument` and route INSTANCE/SYMBOL
resolution through `createSymbolResolver`.

```ts
import { indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import { createSymbolResolver } from "@higma-document-models/fig/symbols";

const document = indexFigKiwiDocument(nodeChanges);
const symbolResolver = createSymbolResolver({ document });

for (const canvas of document.roots) {
  for (const child of document.childrenOf(canvas)) {
    console.log(child.name);
  }
}
```

Important boundaries:

- GUIDs stay as Kiwi `FigGuid` values. There is no node-id/page-id
  translation layer.
- `SymbolResolver` owns INSTANCE target selection, override-key slot
  binding, and traversal of resolved INSTANCE output.
- Renderer-specific render trees live in renderer packages, not in the
  model package.
