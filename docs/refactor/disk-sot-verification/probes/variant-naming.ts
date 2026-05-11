/**
 * Probe: in real components.fig, examine the SYMBOL nodes and their FRAME parents.
 * Hypothesis: variant sets are FRAMEs whose direct SYMBOL children carry
 * `Prop=Value` names.
 */

import { readFile } from "node:fs/promises";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";

const FIG_PATH = process.argv[2] ?? "packages/@higma-document-renderers/fig/fixtures/components/components.fig";

function guidStr(g: { sessionID: number; localID: number } | undefined): string {
  if (!g) {
    return "<none>";
  }
  return `${g.sessionID}:${g.localID}`;
}

async function main(): Promise<void> {
  const bytes = await readFile(FIG_PATH);
  const loaded = await loadFigFile(new Uint8Array(bytes));

  const byGuid = new Map<string, typeof loaded.nodeChanges[number]>();
  for (const node of loaded.nodeChanges) {
    if (node.guid) {
      byGuid.set(guidStr(node.guid), node);
    }
  }

  console.log("=== SYMBOL nodes (= disk encoding of 'Component') ===");
  for (const node of loaded.nodeChanges) {
    if (node.type?.name !== "SYMBOL") {
      continue;
    }
    const parentRef = (node as Record<string, unknown>).parentIndex as
      | { guid?: { sessionID: number; localID: number }; position?: string }
      | undefined;
    const parentGuid = parentRef?.guid ? guidStr(parentRef.guid) : "<root>";
    const parent = parentRef?.guid ? byGuid.get(parentGuid) : undefined;
    const parentType = parent?.type?.name ?? "<none>";
    const parentName = parent?.name ?? "<none>";

    console.log(`  SYMBOL  name=${JSON.stringify(node.name ?? "")}  guid=${guidStr(node.guid)}`);
    console.log(`     parent: ${parentType}  name=${JSON.stringify(parentName)}  guid=${parentGuid}`);
    const eq = /^[^=]+=[^=]+/.test(node.name ?? "");
    console.log(`     name matches /^[^=]+=[^=]+/?  ${eq}`);
  }

  console.log("\n=== FRAME nodes that have >=2 SYMBOL children with `Prop=Value` names ===");
  for (const parent of loaded.nodeChanges) {
    if (parent.type?.name !== "FRAME") {
      continue;
    }
    const childSymbols = loaded.nodeChanges.filter((n) => {
      if (n.type?.name !== "SYMBOL") {
        return false;
      }
      const p = (n as Record<string, unknown>).parentIndex as
        | { guid?: { sessionID: number; localID: number } }
        | undefined;
      return p?.guid && parent.guid && p.guid.sessionID === parent.guid.sessionID && p.guid.localID === parent.guid.localID;
    });
    if (childSymbols.length < 2) {
      continue;
    }
    const named = childSymbols.filter((c) => /^[^=]+=[^=]+/.test(c.name ?? ""));
    if (named.length < 2) {
      continue;
    }
    console.log(`  FRAME  name=${JSON.stringify(parent.name ?? "")}  guid=${guidStr(parent.guid)}`);
    for (const c of childSymbols) {
      console.log(`     child SYMBOL  name=${JSON.stringify(c.name ?? "")}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
