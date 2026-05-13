/**
 * Dump the geometry / display-related fields of a real variant-set parent
 * FRAME and its child SYMBOLs, so file D can place them realistically.
 */

import { readFile } from "node:fs/promises";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import { inspect } from "node:util";

const PATH = process.env.SDS_FIG_PATH;
if (!PATH) {
  throw new Error("SDS_FIG_PATH must point to `Simple Design System (Community).fig`");
}
const TARGET = process.argv[2] ?? "9762:426"; // "Button" variant set referenced by INSTANCE 4:10169

type Guid = { readonly sessionID: number; readonly localID: number };
function guidStr(g: Guid | undefined): string {
  return g ? `${g.sessionID}:${g.localID}` : "<none>";
}

async function main(): Promise<void> {
  const bytes = await readFile(PATH);
  const loaded = await loadFigFile(new Uint8Array(bytes));
  const nodes = loaded.nodeChanges;

  const parent = nodes.find((n) => guidStr(n.guid) === TARGET);
  if (!parent) {
    throw new Error(`${TARGET} not found`);
  }
  console.log(`=== parent FRAME ${TARGET}  name=${JSON.stringify(parent.name ?? "")}  type=${inspect(parent.type)} ===`);
  for (const k of [
    "transform", "size", "clipsContent", "stackMode",
    "fillPaints", "backgroundPaints", "strokePaints", "strokeWeight",
    "componentPropDefs", "isStateGroup", "isPublishable",
    "stateGroupPropertyValueOrders", "stackPrimarySizing", "stackCounterSizing",
    "stackSpacing", "stackHorizontalPadding", "stackVerticalPadding",
    "version", "userFacingVersion", "publishedVersion",
  ]) {
    const v = (parent as Record<string, unknown>)[k];
    if (v === undefined) {
      continue;
    }
    const s = inspect(v, { depth: 5, colors: false });
    const trim = s.length > 600 ? s.slice(0, 600) + " ...[truncated]" : s;
    console.log(`  ${k}: ${trim}`);
  }

  console.log(`\n=== variant child SYMBOLs ===`);
  const kids = nodes.filter((n) => {
    const p = n.parentIndex?.guid;
    return p && guidStr(p) === TARGET;
  });
  for (const c of kids.slice(0, 4)) {
    console.log(`\n  SYMBOL guid=${guidStr(c.guid)}  name=${JSON.stringify(c.name ?? "")}`);
    for (const k of ["transform", "size", "clipsContent", "stackMode"]) {
      const v = (c as Record<string, unknown>)[k];
      if (v === undefined) {
        continue;
      }
      const s = inspect(v, { depth: 5, colors: false });
      console.log(`    ${k}: ${s.length > 200 ? s.slice(0, 200) + "..." : s}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
