/**
 * @file Scan a `.fig` file for Kiwi fields on every node, counting occurrences.
 *
 * Usage:
 *   bun packages/@higma-document-renderers/fig/scripts/scan-kiwi-fields.ts <path-to.fig>
 *
 * Output:
 *   - Top 80 fields by occurrence
 *   - Rare fields (<20 occurrences) as candidates for unhandled-domain triage
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseFigFile } from "@higma-document-io/fig/parser";
import { indexFigKiwiDocument } from "@higma-document-models/fig/domain";

async function main(): Promise<void> {
  const figPath = process.argv[2];
  if (!figPath) {
    console.error("Usage: bun scan-kiwi-fields.ts <path-to.fig>");
    process.exit(1);
  }
  const absPath = path.resolve(figPath);
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  const data = fs.readFileSync(absPath);
  const parsed = await parseFigFile(new Uint8Array(data));
  const document = indexFigKiwiDocument(parsed.nodeChanges);

  const counts = new Map<string, number>();
  for (const node of document.nodesByGuid.values()) {
    for (const key of Object.keys(node)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`Top 80 Kiwi fields (count, field name):`);
  for (const [k, v] of sorted.slice(0, 80)) {
    console.log(`  ${String(v).padStart(5)}  ${k}`);
  }

  console.log(`\nRare fields (<20 occurrences):`);
  for (const [k, v] of sorted) {
    if (v >= 20) {
      continue;
    }
    console.log(`  ${String(v).padStart(3)}  ${k}`);
  }
}

await main();
