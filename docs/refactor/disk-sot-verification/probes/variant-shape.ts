/**
 * Dump the exact componentPropDefs / variantPropSpecs shape for one small
 * variant set from Simple Design System.fig — so we know what to write in
 * file C.
 *
 * Pick a small example to keep the dump readable. The probe earlier showed
 * "Accordion Item" (guid 48:15674) with 2 children: State=Open / State=Closed.
 */

import { readFile } from "node:fs/promises";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import { inspect } from "node:util";

const PATH = process.env.SDS_FIG_PATH;
if (!PATH) {
  throw new Error("SDS_FIG_PATH must point to `Simple Design System (Community).fig`");
}
const TARGET_GUID = "48:15674"; // "Accordion Item" FRAME

type Guid = { readonly sessionID: number; readonly localID: number };

function guidStr(g: Guid | undefined): string {
  if (!g) {
    return "<none>";
  }
  return `${g.sessionID}:${g.localID}`;
}

async function main(): Promise<void> {
  const bytes = await readFile(PATH);
  const loaded = await loadFigFile(new Uint8Array(bytes));
  const nodes = loaded.nodeChanges;

  const parent = nodes.find((n) => guidStr(n.guid) === TARGET_GUID);
  if (!parent) {
    throw new Error(`parent ${TARGET_GUID} not found`);
  }
  console.log("=== parent FRAME ===");
  console.log("guid:", guidStr(parent.guid), "name:", parent.name, "type:", parent.type);
  const propDefs = (parent as Record<string, unknown>).componentPropDefs;
  console.log("componentPropDefs:");
  console.log(inspect(propDefs, { depth: 6, colors: false }));

  // also dump every other unique-ish key so we know what else lives on the parent
  console.log("\n=== full key set on parent (excluding bulky geometry) ===");
  const skip = new Set(["fillGeometry", "strokeGeometry", "vectorPaths", "vectorData", "fillPaints", "strokePaints", "effects", "backgroundPaints"]);
  for (const [k, v] of Object.entries(parent)) {
    if (skip.has(k)) {
      continue;
    }
    if (v === undefined) {
      continue;
    }
    const s = inspect(v, { depth: 4, colors: false });
    const trimmed = s.length > 400 ? s.slice(0, 400) + " ...[truncated]" : s;
    console.log(`  ${k}: ${trimmed}`);
  }

  console.log("\n=== children SYMBOLs ===");
  const kids = nodes.filter((n) => {
    const p = n.parentIndex?.guid;
    return p && guidStr(p) === TARGET_GUID;
  });
  for (const c of kids) {
    console.log(`\nSYMBOL guid=${guidStr(c.guid)}  name=${JSON.stringify(c.name ?? "")}  type=${inspect(c.type)}`);
    const specs = (c as Record<string, unknown>).variantPropSpecs;
    console.log("  variantPropSpecs:");
    console.log(inspect(specs, { depth: 6, colors: false }).split("\n").map((l) => "    " + l).join("\n"));
    const compRefs = (c as Record<string, unknown>).componentPropRefs;
    console.log("  componentPropRefs:");
    console.log(inspect(compRefs, { depth: 4, colors: false }).split("\n").map((l) => "    " + l).join("\n"));
    const compDefs = (c as Record<string, unknown>).componentPropDefs;
    if (compDefs) {
      console.log("  componentPropDefs (on SYMBOL):");
      console.log(inspect(compDefs, { depth: 4, colors: false }).split("\n").map((l) => "    " + l).join("\n"));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
