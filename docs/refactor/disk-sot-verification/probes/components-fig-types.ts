/**
 * Probe: inspect what node types live in components.fig.
 * Purpose: confirm SoT hypothesis — real .fig files only contain SYMBOL
 * for the "Component" concept, never COMPONENT/COMPONENT_SET.
 */

import { readFile } from "node:fs/promises";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";

const FIG_PATH = "packages/@higma-document-renderers/fig/fixtures/components/components.fig";

async function main(): Promise<void> {
  const bytes = await readFile(FIG_PATH);
  const loaded = await loadFigFile(new Uint8Array(bytes));

  const typeHistogram = new Map<string, number>();
  for (const node of loaded.nodeChanges) {
    const name = node.type?.name ?? "<no-type>";
    typeHistogram.set(name, (typeHistogram.get(name) ?? 0) + 1);
  }

  console.log("=== node type histogram in components.fig ===");
  const sorted = [...typeHistogram.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted) {
    console.log(`  ${name.padEnd(24)} ${count}`);
  }

  console.log("\n=== NodeType enum entries declared in this file's schema ===");
  const nodeTypeDef = loaded.schema.definitions.find((d) => d.name === "NodeType");
  if (!nodeTypeDef) {
    console.log("  (no NodeType definition!)");
    return;
  }
  const names = (nodeTypeDef.fields ?? []).map((f) => `${f.value}:${f.name}`);
  console.log(`  total entries: ${names.length}`);
  const hasComponent = names.some((n) => n.endsWith(":COMPONENT"));
  const hasComponentSet = names.some((n) => n.endsWith(":COMPONENT_SET"));
  console.log(`  declares COMPONENT?      ${hasComponent}`);
  console.log(`  declares COMPONENT_SET?  ${hasComponentSet}`);
  console.log("  full list:");
  for (const n of names) {
    console.log(`    ${n}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
