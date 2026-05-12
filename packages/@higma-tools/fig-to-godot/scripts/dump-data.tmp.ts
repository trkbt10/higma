import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createFigSymbolContext } from "@higma-document-io/fig/context";
const target = process.argv[2]; const FRAME = process.argv[3];
const buf = await readFile(resolve(`<REPO>/packages/@higma-document-renderers/fig/fixtures/${target}/${target}.fig`));
const ctx = await createFigSymbolContext(new Uint8Array(buf));
const doc = ctx.tree.roots.find((r: any) => r?.type?.name === "DOCUMENT");
const canvases = doc?.children?.filter((r: any) => r?.type?.name === "CANVAS" && r.internalOnly !== true);
let frame: any = null;
for (const canvas of canvases) {
  const f = canvas.children?.find((c: any) => c.name === FRAME);
  if (f) { frame = f; break; }
}
function walk(n: any, depth = 0): void {
  if (!n || !n.type) return;
  console.log("  ".repeat(depth) + JSON.stringify({type:n.type?.name, name:n.name, fillPaints:n.fillPaints?.length, effects:n.effects, size:n.size}));
  for (const c of (n.children ?? [])) walk(c, depth + 1);
}
walk(frame);
