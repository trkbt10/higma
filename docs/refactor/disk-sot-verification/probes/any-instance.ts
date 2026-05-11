/**
 * Dump the first 3 INSTANCE nodes in Simple Design System.fig so we can see
 * the actual referencing fields (symbolData? or top-level symbolID?).
 */

import { readFile } from "node:fs/promises";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import { inspect } from "node:util";

const PATH = "<DOWNLOADS>/Simple Design System (Community).fig";

async function main(): Promise<void> {
  const bytes = await readFile(PATH);
  const loaded = await loadFigFile(new Uint8Array(bytes));
  const instances = loaded.nodeChanges.filter((n) => n.type?.name === "INSTANCE");
  console.log(`total INSTANCEs: ${instances.length}`);
  for (const inst of instances.slice(0, 3)) {
    console.log(`\n--- INSTANCE name=${JSON.stringify(inst.name ?? "")}  guid=${inspect(inst.guid)} ---`);
    // dump every key whose value is non-undefined and not a giant geometry array
    const skip = new Set([
      "fillGeometry", "strokeGeometry", "vectorPaths", "vectorData",
    ]);
    for (const [k, v] of Object.entries(inst)) {
      if (skip.has(k) || v === undefined) {
        continue;
      }
      const s = inspect(v, { depth: 6, colors: false });
      const trim = s.length > 1500 ? s.slice(0, 1500) + " ...[truncated]" : s;
      console.log(`  ${k}: ${trim}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
