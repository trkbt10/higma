# @higma-document-editors/fig

React boundary for `.fig` Kiwi documents.

This package does not own a document model. Callers pass a
`FigDocumentContext`; the context keeps `nodeChanges` as the source of
truth and exposes SymbolResolver/resource lookup for rendering.

```tsx
import { useState } from "react";
import { FigEditor, useFigFileLoad } from "@higma-document-editors/fig";
import type { FigDocumentContext } from "@higma-document-io/fig";

export function App() {
  const [context, setContext] = useState<FigDocumentContext | null>(null);
  const { loadFromFile } = useFigFileLoad();

  if (context === null) {
    return (
      <input
        type="file"
        accept=".fig"
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          if (file === undefined) {
            return;
          }
          setContext(await loadFromFile(file));
        }}
      />
    );
  }

  return (
    <FigEditor
      context={context}
      canvasWidth={1440}
      canvasHeight={960}
      viewport={{ x: 0, y: 0, width: 1440, height: 960 }}
    />
  );
}
```
