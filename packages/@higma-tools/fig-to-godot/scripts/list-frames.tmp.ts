import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createFigSymbolContext } from "@higma-document-io/fig/context";
const target = process.argv[2];
const buf = await readFile(resolve(`<REPO>/packages/@higma-document-renderers/fig/fixtures/${target}/${target}.fig`));
const ctx = await createFigSymbolContext(new Uint8Array(buf));
const doc = ctx.tree.roots.find((r: any) => r?.type?.name === "DOCUMENT");
const canvases = doc?.children?.filter((r: any) => r?.type?.name === "CANVAS" && r.internalOnly !== true);
for (const canvas of canvases) {
  for (const c of canvas.children ?? []) {
    console.log(c.name);
  }
}
