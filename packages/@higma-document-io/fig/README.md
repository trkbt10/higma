# @higma-document-io/fig

I/O boundary for `.fig` Kiwi documents.

The loaded `nodeChanges` array is the document source of truth. The
package exposes `FigDocumentContext`, which indexes that array for
GUID and parent-child access, plus one document-bound `SymbolResolver`
for every INSTANCE/SYMBOL decision.

```ts
import { createFigDocumentContext } from "@higma-document-io/fig/context";

const bytes = new Uint8Array(await Bun.file("design.fig").arrayBuffer());
const ctx = await createFigDocumentContext(bytes);

for (const root of ctx.document.roots) {
  for (const child of ctx.document.childrenOf(root)) {
    console.log(child.name);
  }
}
```

Rendering or analysis consumers should pass `figDocumentResources(ctx)`
instead of rebuilding parallel indexes. There is no editor-owned
document model in this package.
