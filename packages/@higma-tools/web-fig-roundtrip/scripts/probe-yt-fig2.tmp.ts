/**
 * Inspect the youtube.fig: find ytd-mini-guide-renderer and its
 * descendants — what mode / size / positioning it has, and the
 * positioning of its mini-guide-entry children.
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseFigFile } from "@higma-document-io/fig/parser";

async function main(): Promise<void> {
  const bytes = await readFile("<REPO>/.tmp-output/youtube-fidelity/youtube.fig");
  const parsed = await parseFigFile(bytes);
  type Field = { value: number; name: string };
  type Node = {
    guid: { sessionID: number; localID: number };
    parentIndex?: { guid: { sessionID: number; localID: number }; position: string };
    type: Field;
    name: string;
    size?: { x: number; y: number };
    transform?: { m02: number; m12: number };
    stackMode?: Field;
    stackPositioning?: Field;
    stackPrimaryAlignItems?: Field;
    stackCounterAlignItems?: Field;
  };
  const nodes = parsed.nodeChanges as readonly Node[];
  const key = (g: { sessionID: number; localID: number }): string => `${g.sessionID}:${g.localID}`;
  const byGuid = new Map<string, Node>();
  for (const n of nodes) byGuid.set(key(n.guid), n);
  const childrenByParent = new Map<string, Node[]>();
  for (const n of nodes) {
    if (!n.parentIndex) continue;
    const k = key(n.parentIndex.guid);
    const arr = childrenByParent.get(k) ?? [];
    arr.push(n);
    childrenByParent.set(k, arr);
  }
  const target = nodes.find((n) => n.name === "ytd-mini-guide-renderer");
  if (!target) {
    await writeFile("/tmp/yt-fig2.json", JSON.stringify({ found: false }, null, 2));
    return;
  }

  function dump(n: Node, depth: number, lines: string[]): void {
    const sz = n.size ?? { x: -1, y: -1 };
    const tx = n.transform ?? { m02: -1, m12: -1 };
    const layout = n.stackMode ? `mode=${n.stackMode.name} primAlign=${n.stackPrimaryAlignItems?.name ?? "-"} counterAlign=${n.stackCounterAlignItems?.name ?? "-"}` : "-";
    const pos = n.stackPositioning?.name ?? "-";
    lines.push(`${"  ".repeat(depth)}${n.type.name} ${n.name} size=(${sz.x},${sz.y}) tx=(${tx.m02},${tx.m12}) pos=${pos} ${layout}`);
    const kids = childrenByParent.get(key(n.guid)) ?? [];
    for (const c of kids) dump(c, depth + 1, lines);
  }
  const lines: string[] = [];
  dump(target, 0, lines);
  await writeFile("/tmp/yt-fig2.txt", lines.join("\n") + "\n");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
