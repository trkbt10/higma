/**
 * Diagnostic G2:
 *   Start from components.fig (passthrough = G1 verified to open in Figma)
 *   and remove everything except DOCUMENT and one CANVAS. No subtree
 *   extraction, no foreign nodes — just a deletion. Does Figma still open
 *   it?
 *   If yes: deletion alone is safe; F's break is in the things we added.
 *   If no: even deletion breaks the file; something in components.fig
 *           cross-references nodes we can't remove blindly.
 */

import { readFile, writeFile } from "node:fs/promises";
import { loadFigFile, saveFigFile } from "@higma-document-io/fig/roundtrip";

const SOURCE = "packages/@higma-document-renderers/fig/fixtures/components/components.fig";
const OUT = "docs/refactor/disk-sot-verification/artifacts/G2-empty-canvas.fig";

async function main(): Promise<void> {
  const bytes = await readFile(SOURCE);
  const loaded = await loadFigFile(new Uint8Array(bytes));

  const document = loaded.nodeChanges.find((n) => n.type?.name === "DOCUMENT");
  const canvas = loaded.nodeChanges.find((n) => n.type?.name === "CANVAS" && n.name === "Components Canvas");
  if (!document || !canvas) {
    throw new Error("DOCUMENT/CANVAS not found in source");
  }

  const data = await saveFigFile(
    {
      ...loaded,
      nodeChanges: [document, canvas],
    },
    { reencodeSchema: true },
  );
  await writeFile(OUT, data);
  console.log(`wrote ${OUT}  (${data.length} bytes)`);
  console.log(`  nodes: 2 (DOCUMENT + CANVAS only)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
