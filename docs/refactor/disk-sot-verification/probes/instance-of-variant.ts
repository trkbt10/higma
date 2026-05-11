/**
 * For a known variant-set parent FRAME, list its variant child SYMBOLs,
 * then find INSTANCEs whose symbolID matches any of them. Used to confirm
 * the referencing pattern.
 */

import { readFile } from "node:fs/promises";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";

const PATH = "<DOWNLOADS>/Simple Design System (Community).fig";
const VARIANT_PARENT = process.argv[2] ?? "48:15674"; // Accordion Item by default

type Guid = { readonly sessionID: number; readonly localID: number };
function guidStr(g: Guid | undefined): string {
  return g ? `${g.sessionID}:${g.localID}` : "<none>";
}

async function main(): Promise<void> {
  const bytes = await readFile(PATH);
  const loaded = await loadFigFile(new Uint8Array(bytes));
  const nodes = loaded.nodeChanges;

  const childGuids = nodes
    .filter((n) => {
      const p = n.parentIndex?.guid;
      return p && guidStr(p) === VARIANT_PARENT && n.type?.name === "SYMBOL";
    })
    .map((n) => guidStr(n.guid))
    .filter((g): g is string => g !== "<none>");

  console.log(`variant parent: ${VARIANT_PARENT}`);
  console.log(`variant child SYMBOL guids (${childGuids.length}): ${childGuids.join(", ")}`);

  const matches: Array<{ inst: typeof nodes[number]; ref: string; via: string }> = [];
  for (const inst of nodes) {
    if (inst.type?.name !== "INSTANCE") {
      continue;
    }
    const symData = (inst as Record<string, unknown>).symbolData as
      | { symbolID?: Guid }
      | undefined;
    const refGuid = symData?.symbolID ? guidStr(symData.symbolID) : undefined;
    if (refGuid && childGuids.includes(refGuid)) {
      matches.push({ inst, ref: refGuid, via: "symbolData.symbolID" });
      continue;
    }
    // also check top-level symbolID
    const topSym = (inst as Record<string, unknown>).symbolID as Guid | undefined;
    const topGuid = topSym ? guidStr(topSym) : undefined;
    if (topGuid && childGuids.includes(topGuid)) {
      matches.push({ inst, ref: topGuid, via: "top-level symbolID" });
    }
  }
  console.log(`\nINSTANCEs that point at one of these variants: ${matches.length}`);
  for (const m of matches.slice(0, 5)) {
    console.log(`  ${m.via}=${m.ref}  inst guid=${guidStr(m.inst.guid)}  name=${JSON.stringify(m.inst.name ?? "")}`);
  }
  if (matches.length > 5) {
    console.log(`  ... ${matches.length - 5} more`);
  }

  // For the first match, dump just symbolData + propAssignments (if any)
  const m0 = matches[0];
  if (m0) {
    console.log("\n--- first match: identifying fields ---");
    const inst = m0.inst as Record<string, unknown>;
    for (const key of ["symbolData", "componentPropAssignments", "componentPropertyReferences", "componentPropRefs", "userFacingVersion"]) {
      if (inst[key] !== undefined) {
        console.log(`  ${key}:`);
        console.log("    " + JSON.stringify(inst[key]).slice(0, 800));
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
