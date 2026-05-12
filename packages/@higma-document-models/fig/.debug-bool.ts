import { parseFigFile } from "./src/parse";
import { readFile } from "node:fs/promises";

const data = await readFile("<REPO>/packages/@higma-document-renderers/fig/fixtures/boolean/boolean.fig");
const { nodeChanges } = await parseFigFile(data);

const target = nodeChanges.find(n => n.name === "bool-opacity");
if (!target) { console.log("Not found"); process.exit(1); }

console.log("frame:", target.name, "type:", target.type?.name, "opacity:", target.opacity);
console.log("guid:", target.guid);

function findChildren(parentGuid: any) {
  return nodeChanges.filter(n => n.parent && n.parent.guid && n.parent.guid.sessionID === parentGuid.sessionID && n.parent.guid.localID === parentGuid.localID);
}

const kids = findChildren(target.guid);
for (const k of kids) {
  console.log(`  child: ${k.name} type=${k.type?.name} opacity=${k.opacity}`);
  const gkids = findChildren(k.guid);
  for (const gk of gkids) {
    console.log(`    grandchild: ${gk.name} type=${gk.type?.name} opacity=${gk.opacity}`);
    const ggkids = findChildren(gk.guid);
    for (const ggk of ggkids) {
      console.log(`      great-grandchild: ${ggk.name} type=${ggk.type?.name} opacity=${ggk.opacity}`);
    }
  }
}
