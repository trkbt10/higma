/**
 * For each node in the subtree (Radio Icon + descendants) and the host
 * Internal Only Canvas, dump the full set of keys present so we can spot
 * fields that may still reference external state and weren't stripped.
 */

import { readFile } from "node:fs/promises";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";

const PATH = process.env.SDS_FIG_PATH;
if (!PATH) {
  throw new Error("SDS_FIG_PATH must point to `Simple Design System (Community).fig`");
}
const TARGET_GUIDS = ["0:2", "9762:1405", "9762:1406", "9762:1407", "9762:1408", "9762:1409", "9762:1410", "9762:1411"];

type Guid = { readonly sessionID: number; readonly localID: number };
function guidStr(g: Guid | undefined): string {
  return g ? `${g.sessionID}:${g.localID}` : "<none>";
}

async function main(): Promise<void> {
  const bytes = await readFile(PATH);
  const loaded = await loadFigFile(new Uint8Array(bytes));
  for (const id of TARGET_GUIDS) {
    const n = loaded.nodeChanges.find((x) => guidStr(x.guid) === id);
    if (!n) {
      console.log(`\n=== ${id} NOT FOUND ===`);
      continue;
    }
    console.log(`\n=== ${id}  ${n.type?.name}  name=${JSON.stringify(n.name ?? "")} ===`);
    const keys = Object.keys(n).filter((k) => (n as Record<string, unknown>)[k] !== undefined);
    console.log(`  keys (${keys.length}):`);
    for (const k of keys) {
      const v = (n as Record<string, unknown>)[k];
      const t = Array.isArray(v) ? `array[${v.length}]` : (typeof v === "object" && v !== null ? "object" : typeof v);
      console.log(`    ${k.padEnd(38)} : ${t}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
