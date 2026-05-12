import { parseFigFile } from "@higma-document-models/fig";
import { readFile } from "node:fs/promises";

const data = await readFile("<REPO>/packages/@higma-document-renderers/fig/fixtures/boolean/boolean.fig");
const { nodeChanges } = await parseFigFile(data);

// Find bool-opacity frame
const target = nodeChanges.find(n => n.name === "bool-opacity");
if (!target) {
  console.log("Not found");
  process.exit(1);
}
console.log("frame:", target.name, "guid:", target.guid, "opacity:", target.opacity, "type:", target.type?.name);

// Children
function findChildren(parentGuid: string) {
  return nodeChanges.filter(n => n.parent && `${n.parent.guid.sessionID}:${n.parent.localID}` === parentGuid);
}

const tg = `${target.guid.sessionID}:${target.guid.localID}`;
const kids = findChildren(tg);
for (const k of kids) {
  console.log(`  child: ${k.name} type=${k.type?.name} opacity=${k.opacity} guid=${k.guid.sessionID}:${k.guid.localID}`);
  const gkids = findChildren(`${k.guid.sessionID}:${k.guid.localID}`);
  for (const gk of gkids) {
    console.log(`    grandchild: ${gk.name} type=${gk.type?.name} opacity=${gk.opacity}`);
  }
}
