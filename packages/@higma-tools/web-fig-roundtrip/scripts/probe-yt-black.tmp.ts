/**
 * Find frames in the youtube .fig with size > 200x200 and black fill.
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseFigFile } from "@higma-document-io/fig/parser";

async function main(): Promise<void> {
  const bytes = await readFile("<REPO>/.tmp-output/youtube-fidelity-direct/youtube.fig");
  const parsed = await parseFigFile(bytes);
  const allRecords = parsed.nodeChanges as readonly Record<string, unknown>[];
  // also dump anything <100x100 at x<400, y<400, with non-trivial fill (non-white)
  // dump all ABSOLUTE-positioned frames (= fixed/sticky)
  const abs: string[] = [];
  for (const n of allRecords) {
    const pos = n.stackPositioning as { name: string } | undefined;
    if (!pos || pos.name !== "ABSOLUTE") continue;
    const sz = n.size as { x: number; y: number } | undefined;
    const tx = n.transform as { m02: number; m12: number } | undefined;
    const t = n.type as { name: string };
    const fp = n.fillPaints as { type?: { name: string }; color?: { r: number; g: number; b: number; a: number }; visible?: boolean }[] | undefined;
    const fillStr = fp && fp.length > 0 ? fp.map((f) => `[${f.color ? `rgba(${f.color.r.toFixed(2)},${f.color.g.toFixed(2)},${f.color.b.toFixed(2)},${f.color.a.toFixed(2)})` : "-"}]`).join(",") : "(none)";
    abs.push(`${t.name} name="${n.name}" size=(${sz?.x ?? "-"},${sz?.y ?? "-"}) tx=(${tx?.m02 ?? "-"},${tx?.m12 ?? "-"}) fills=${fillStr}`);
  }
  await writeFile("/tmp/yt-abs.txt", abs.join("\n") + "\n");
  process.stdout.write(`absolute count: ${abs.length}\n`);

  // dump wrapper FRAMEs + their direct children (first 5)
  const wrapper: string[] = [];
  for (const n of allRecords) {
    const t = n.type as { name: string };
    if (t.name !== "FRAME") continue;
    const name = n.name as string;
    if (!/^(mobile|tablet|desktop)\s*\//.test(name)) continue;
    const fp = n.fillPaints as { type?: { name: string }; color?: { r: number; g: number; b: number; a: number }; visible?: boolean }[] | undefined;
    const fillStr = fp && fp.length > 0 ? fp.map((f) => `[${f.color ? `rgba(${f.color.r.toFixed(2)},${f.color.g.toFixed(2)},${f.color.b.toFixed(2)},${f.color.a.toFixed(2)})` : "-"}]`).join(",") : "(none)";
    wrapper.push(`${name} fills=${fillStr}`);
  }
  await writeFile("/tmp/yt-wrappers.txt", wrapper.join("\n") + "\n");

  // Find the SYMBOL and dump its first-level black children.
  const symbols = allRecords.filter((n) => (n.type as { name: string }).name === "SYMBOL");
  const allBlackInSymbol: string[] = [];
  for (const sym of symbols) {
    const guid = sym.guid as { sessionID: number; localID: number };
    const symKey = `${guid.sessionID}:${guid.localID}`;
    for (const n of allRecords) {
      const fp = n.fillPaints as { color?: { r: number; g: number; b: number; a: number }; visible?: boolean }[] | undefined;
      if (!fp) continue;
      let isBlack = false;
      for (const f of fp) {
        if (f.visible === false) continue;
        const c = f.color;
        if (!c) continue;
        if (c.r < 0.1 && c.g < 0.1 && c.b < 0.1 && c.a > 0.5) {
          isBlack = true;
          break;
        }
      }
      if (!isBlack) continue;
      const sz = n.size as { x: number; y: number } | undefined;
      const tx = n.transform as { m02: number; m12: number } | undefined;
      const t = n.type as { name: string };
      const fillStr = fp.map((f) => `[${f.color ? `rgba(${f.color.r.toFixed(2)},${f.color.g.toFixed(2)},${f.color.b.toFixed(2)},${f.color.a.toFixed(2)})` : "-"} v=${f.visible ?? true}]`).join(",");
      allBlackInSymbol.push(`${t.name} name="${n.name}" size=(${sz?.x ?? "-"},${sz?.y ?? "-"}) tx=(${tx?.m02 ?? "-"},${tx?.m12 ?? "-"}) ${fillStr}`);
    }
    void symKey;
  }
  await writeFile("/tmp/yt-allblack.txt", allBlackInSymbol.join("\n") + "\n");
  process.stdout.write(`black-fill nodes anywhere: ${allBlackInSymbol.length}\n`);

  // Find the giant VECTOR and walk its ancestor chain
  const giant = allRecords.find((n) => {
    const t = n.type as { name: string };
    if (t.name !== "VECTOR") return false;
    const sz = n.size as { x: number; y: number } | undefined;
    return sz !== undefined && sz.x > 1000;
  });
  if (giant) {
    process.stdout.write(`giant childAlignSelf=${(giant.stackChildAlignSelf as { name?: string } | undefined)?.name ?? "-"}\n`);
    process.stdout.write(`giant primarySizing=${(giant.stackPrimarySizing as { name?: string } | undefined)?.name ?? "-"}\n`);
    process.stdout.write(`giant counterSizing=${(giant.stackCounterSizing as { name?: string } | undefined)?.name ?? "-"}\n`);
  }
  if (giant) {
    const guidKey = (g: { sessionID: number; localID: number }): string => `${g.sessionID}:${g.localID}`;
    const byGuid = new Map<string, Record<string, unknown>>();
    for (const n of allRecords) {
      const g = n.guid as { sessionID: number; localID: number } | undefined;
      if (g) byGuid.set(guidKey(g), n);
    }
    const chain: string[] = [];
    let cur: Record<string, unknown> | undefined = giant;
    while (cur) {
      const t = cur.type as { name: string };
      const sz = cur.size as { x: number; y: number } | undefined;
      const tx = cur.transform as { m02: number; m12: number } | undefined;
      chain.push(`${t.name} name="${cur.name}" size=(${sz?.x ?? "-"},${sz?.y ?? "-"}) tx=(${tx?.m02 ?? "-"},${tx?.m12 ?? "-"})`);
      const p = cur.parentIndex as { guid: { sessionID: number; localID: number } } | undefined;
      if (!p) break;
      cur = byGuid.get(guidKey(p.guid));
    }
    chain.reverse();
    await writeFile("/tmp/yt-giant.txt", chain.join("\n") + "\n");
  }
  const out: string[] = [];
  type Color = { r: number; g: number; b: number; a: number };
  type Paint = { type?: { name: string }; color?: Color; visible?: boolean; opacity?: number };
  for (const n of parsed.nodeChanges as readonly Record<string, unknown>[]) {
    const sz = n.size as { x: number; y: number } | undefined;
    if (!sz) continue;
    if (sz.x < 50 || sz.y < 50) continue;
    if (sz.x > 600 || sz.y > 600) continue;
    const fills = n.fillPaints as Paint[] | undefined;
    if (!fills) continue;
    for (const f of fills) {
      if (f.visible === false) continue;
      const c = f.color;
      if (!c) continue;
      const isBlack = c.r < 0.05 && c.g < 0.05 && c.b < 0.05;
      if (!isBlack) continue;
      const tx = n.transform as { m02: number; m12: number } | undefined;
      const t = n.type as { name: string };
      out.push(`${t.name} name="${n.name}" size=(${sz.x},${sz.y}) tx=(${tx?.m02 ?? "-"},${tx?.m12 ?? "-"}) color=rgba(${c.r.toFixed(2)},${c.g.toFixed(2)},${c.b.toFixed(2)},${c.a})`);
    }
  }
  await writeFile("/tmp/yt-black.txt", out.join("\n") + "\n");
  process.stdout.write(`Found ${out.length} black large frames\n`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
