/**
 * Diagnostic G1:
 *   The simplest possible "round-trip" — load components.fig (known to open
 *   in Figma) and save it back with reencodeSchema:true, no edits.
 *   If THIS fails to open in Figma, the issue is the save pipeline itself,
 *   not anything we did.
 */

import { readFile, writeFile } from "node:fs/promises";
import { loadFigFile, saveFigFile } from "@higma-document-io/fig/roundtrip";

const SOURCE = "packages/@higma-document-renderers/fig/fixtures/components/components.fig";
const OUT = "docs/refactor/disk-sot-verification/artifacts/G1-passthrough-components.fig";

async function main(): Promise<void> {
  const bytes = await readFile(SOURCE);
  const loaded = await loadFigFile(new Uint8Array(bytes));
  const data = await saveFigFile(loaded, { reencodeSchema: true });
  await writeFile(OUT, data);
  console.log(`wrote ${OUT}  (${data.length} bytes; source=${bytes.length})`);
  console.log(`  nodes=${loaded.nodeChanges.length}, blobs=${loaded.blobs.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
