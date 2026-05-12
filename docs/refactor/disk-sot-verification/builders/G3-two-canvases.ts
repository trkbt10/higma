/**
 * Diagnostic G3:
 *   G2 + a second CANVAS marked visible:false ("Internal Only Canvas"),
 *   so we test "multiple canvases incl. a hidden one" before adding any
 *   foreign nodes. Built fresh: no node injection yet.
 */

import { readFile, writeFile } from "node:fs/promises";
import { loadFigFile, saveFigFile, createGuidAllocator } from "@higma-document-io/fig/roundtrip";
import type { FigNode } from "@higma-document-models/fig/types";

const SOURCE = "packages/@higma-document-renderers/fig/fixtures/components/components.fig";
const OUT = "docs/refactor/disk-sot-verification/artifacts/G3-two-canvases.fig";

async function main(): Promise<void> {
  const bytes = await readFile(SOURCE);
  const loaded = await loadFigFile(new Uint8Array(bytes));

  const document = loaded.nodeChanges.find((n) => n.type?.name === "DOCUMENT");
  const canvas = loaded.nodeChanges.find((n) => n.type?.name === "CANVAS" && n.name === "Components Canvas");
  if (!document?.guid || !canvas?.guid) {
    throw new Error("DOCUMENT/CANVAS not found");
  }

  const alloc = createGuidAllocator(loaded);
  const hiddenCanvasGuid = alloc.next();
  const hiddenCanvas: FigNode = {
    guid: hiddenCanvasGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 2, name: "CANVAS" },
    name: "Internal Only Canvas",
    parentIndex: { guid: document.guid, position: "~" },
    visible: false,
  };

  const data = await saveFigFile(
    {
      ...loaded,
      nodeChanges: [document, canvas, hiddenCanvas],
    },
    { reencodeSchema: true },
  );
  await writeFile(OUT, data);
  console.log(`wrote ${OUT}  (${data.length} bytes)`);
  console.log(`  nodes: 3 (DOCUMENT + visible CANVAS + hidden CANVAS)`);
  console.log(`  hidden canvas guid: ${hiddenCanvasGuid.sessionID}:${hiddenCanvasGuid.localID}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
