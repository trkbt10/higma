/**
 * Verify file C roundtrips through loadFigFile and contains the expected
 * componentPropDefs / variantPropSpecs / isStateGroup structure.
 */

import { readFile } from "node:fs/promises";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import { inspect } from "node:util";

async function main(): Promise<void> {
  const bytes = await readFile("docs/refactor/disk-sot-verification/artifacts/C-with-propdefs.fig");
  const loaded = await loadFigFile(new Uint8Array(bytes));

  const frame = loaded.nodeChanges.find((n) => n.name === "Buttons");
  if (!frame) {
    throw new Error("FRAME 'Buttons' not found in C");
  }
  console.log("=== FRAME 'Buttons' (the variant-set parent) ===");
  console.log("type:", frame.type);
  console.log("isStateGroup:", (frame as Record<string, unknown>).isStateGroup);
  console.log("isPublishable:", (frame as Record<string, unknown>).isPublishable);
  console.log("componentPropDefs:");
  console.log(inspect((frame as Record<string, unknown>).componentPropDefs, { depth: 6, colors: false }));
  console.log("stateGroupPropertyValueOrders:");
  console.log(inspect((frame as Record<string, unknown>).stateGroupPropertyValueOrders, { depth: 4, colors: false }));

  for (const name of ["Variant=Solid", "Variant=Outline"]) {
    const sym = loaded.nodeChanges.find((n) => n.name === name);
    if (!sym) {
      console.log(`\n!! SYMBOL ${name} not found`);
      continue;
    }
    console.log(`\n=== SYMBOL ${name} ===`);
    console.log("type:", sym.type);
    console.log("parentIndex:", sym.parentIndex);
    console.log("variantPropSpecs:");
    console.log(inspect((sym as Record<string, unknown>).variantPropSpecs, { depth: 4, colors: false }));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
