/**
 * Find INSTANCEs in Simple Design System.fig whose symbolData.symbolID
 * resolves to a SYMBOL inside the SAME file that is also a child of a
 * variant-set FRAME (componentPropDefs(VARIANT) on parent). These are the
 * "local variant INSTANCEs" we want as a template for file D.
 */

import { readFile } from "node:fs/promises";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import { inspect } from "node:util";

const PATH = "<DOWNLOADS>/Simple Design System (Community).fig";

type Guid = { readonly sessionID: number; readonly localID: number };
function guidStr(g: Guid | undefined): string {
  return g ? `${g.sessionID}:${g.localID}` : "<none>";
}

async function main(): Promise<void> {
  const bytes = await readFile(PATH);
  const loaded = await loadFigFile(new Uint8Array(bytes));
  const nodes = loaded.nodeChanges;

  const byGuid = new Map<string, typeof nodes[number]>();
  for (const n of nodes) {
    if (n.guid) {
      byGuid.set(guidStr(n.guid), n);
    }
  }

  // Identify variant-set parent FRAMEs.
  const variantParents = new Set<string>();
  for (const n of nodes) {
    if (n.type?.name !== "FRAME") {
      continue;
    }
    const defs = (n as Record<string, unknown>).componentPropDefs as
      | Array<{ type?: { name?: string } }>
      | undefined;
    if (defs && defs.some((d) => d.type?.name === "VARIANT")) {
      variantParents.add(guidStr(n.guid));
    }
  }
  console.log(`variant parent FRAMEs (with VARIANT-typed propDef): ${variantParents.size}`);

  // For each INSTANCE, see if its symbolID points at a SYMBOL whose parent is a variant set.
  let localCount = 0;
  for (const inst of nodes) {
    if (inst.type?.name !== "INSTANCE") {
      continue;
    }
    const sym = (inst as Record<string, unknown>).symbolData as
      | { symbolID?: Guid }
      | undefined;
    if (!sym?.symbolID) {
      continue;
    }
    const target = byGuid.get(guidStr(sym.symbolID));
    if (!target) {
      continue;
    }
    const parent = target.parentIndex?.guid ? byGuid.get(guidStr(target.parentIndex.guid)) : undefined;
    if (!parent || !variantParents.has(guidStr(parent.guid))) {
      continue;
    }
    localCount += 1;
    if (localCount <= 3) {
      console.log(`\n--- match #${localCount} ---`);
      console.log(`  INSTANCE  guid=${guidStr(inst.guid)}  name=${JSON.stringify(inst.name ?? "")}`);
      console.log(`  -> SYMBOL guid=${guidStr(target.guid)}  name=${JSON.stringify(target.name ?? "")}`);
      console.log(`  -> parent FRAME guid=${guidStr(parent.guid)}  name=${JSON.stringify(parent.name ?? "")}`);
      console.log(`  symbolData:`);
      console.log(inspect(sym, { depth: 6, colors: false }).split("\n").map((l) => "    " + l).join("\n"));
      const propAss = (inst as Record<string, unknown>).componentPropAssignments;
      if (propAss !== undefined) {
        console.log(`  componentPropAssignments: ${JSON.stringify(propAss).slice(0, 600)}`);
      } else {
        console.log(`  componentPropAssignments: <none>`);
      }
    }
  }
  console.log(`\nTotal local-variant INSTANCEs: ${localCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
