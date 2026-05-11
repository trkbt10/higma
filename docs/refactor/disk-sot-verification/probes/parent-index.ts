/**
 * Probe: dump full structure (parentIndex.position) of components.fig so we
 * understand how to insert a new FRAME with two SYMBOL children.
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

  for (const node of loaded.nodeChanges) {
    const t = node.type?.name ?? "<none>";
    const g = guidStr(node.guid);
    const p = (node as Record<string, unknown>).parentIndex as
      | { guid?: { sessionID: number; localID: number }; position?: string }
      | undefined;
    const parentGuid = p?.guid ? guidStr(p.guid) : "<root>";
    const pos = p?.position ?? "<>";
    console.log(`  ${t.padEnd(18)} guid=${g.padEnd(8)} name=${JSON.stringify(node.name ?? "")}  parent=${parentGuid}  position=${JSON.stringify(pos)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
