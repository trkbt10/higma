/**
 * Find an INSTANCE in Simple Design System.fig that targets one of the
 * known variant-set children, and dump its full Kiwi shape — especially
 * `symbolID`, `componentPropAssignments`, and anything else that might be
 * needed for the "switchable variant" round-trip.
 *
 * Target: "Accordion Item" variant set (parent FRAME 48:15674), whose
 * variant children are State=Open (48:15675) and State=Closed (48:15681).
 */

import { readFile } from "node:fs/promises";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";
import { inspect } from "node:util";

const PATH = "<DOWNLOADS>/Simple Design System (Community).fig";

type Guid = { readonly sessionID: number; readonly localID: number };
function guidStr(g: Guid | undefined): string {
  return g ? `${g.sessionID}:${g.localID}` : "<none>";
}
function guidEq(a: Guid | undefined, b: Guid | undefined): boolean {
  return !!a && !!b && a.sessionID === b.sessionID && a.localID === b.localID;
}

const VARIANT_CHILD_GUIDS = ["48:15675", "48:15681"]; // State=Open / State=Closed

async function main(): Promise<void> {
  const bytes = await readFile(PATH);
  const loaded = await loadFigFile(new Uint8Array(bytes));
  const nodes = loaded.nodeChanges;

  console.log("=== INSTANCE nodes targeting one of the Accordion Item variants ===");
  const candidates = nodes.filter((n) => {
    if (n.type?.name !== "INSTANCE") {
      return false;
    }
    const symData = (n as Record<string, unknown>).symbolData as
      | { symbolID?: Guid }
      | undefined;
    return symData?.symbolID && VARIANT_CHILD_GUIDS.includes(guidStr(symData.symbolID));
  });
  console.log(`  candidates: ${candidates.length}`);

  // Just dump the first 2 so we see the shape.
  for (const inst of candidates.slice(0, 2)) {
    console.log(`\n--- INSTANCE guid=${guidStr(inst.guid)}  name=${JSON.stringify(inst.name ?? "")} ---`);
    const interesting = [
      "symbolData",
      "componentPropAssignments",
      "componentPropertyReferences",
      "componentPropRefs",
      "overriddenSymbolID",
      "derivedSymbolData",
      "symbolOverrides",
      "variableConsumptionMap",
      "parameterConsumptionMap",
      "isPublishable",
      "version",
      "userFacingVersion",
      "publishedVersion",
    ];
    for (const k of interesting) {
      const v = (inst as Record<string, unknown>)[k];
      if (v === undefined) {
        continue;
      }
      const s = inspect(v, { depth: 6, colors: false });
      const trim = s.length > 2000 ? s.slice(0, 2000) + " ...[truncated]" : s;
      console.log(`  ${k}:`);
      console.log(trim.split("\n").map((l) => "    " + l).join("\n"));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
