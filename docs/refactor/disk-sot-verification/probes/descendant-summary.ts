/**
 * Walk all descendants of a target node, summarising the per-type counts
 * and flagging out-of-scope references (variableConsumption, style ids,
 * symbolID pointing outside the descendant set, etc.). Used to plan how
 * to extract a self-contained subset.
 */

import { readFile } from "node:fs/promises";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";

const PATH = process.argv[2] ?? process.env.SDS_FIG_PATH;
if (!PATH) {
  throw new Error("Pass path to `Simple Design System (Community).fig` as argv[2] or SDS_FIG_PATH");
}
const ROOT = process.argv[3] ?? "48:15674";

type Guid = { readonly sessionID: number; readonly localID: number };

function guidStr(g: Guid | undefined): string {
  return g ? `${g.sessionID}:${g.localID}` : "<none>";
}

async function main(): Promise<void> {
  const bytes = await readFile(PATH);
  const loaded = await loadFigFile(new Uint8Array(bytes));
  const nodes = loaded.nodeChanges;

  // Build child index.
  const childrenOf = new Map<string, typeof nodes[number][]>();
  for (const n of nodes) {
    const p = n.parentIndex?.guid;
    if (p) {
      const k = guidStr(p);
      const list = childrenOf.get(k) ?? [];
      list.push(n);
      childrenOf.set(k, list);
    }
  }

  const root = nodes.find((n) => guidStr(n.guid) === ROOT);
  if (!root) {
    throw new Error(`root ${ROOT} not found`);
  }

  // BFS collect descendants.
  const descendants: typeof nodes[number][] = [root];
  const queue: string[] = [ROOT];
  const seen = new Set<string>([ROOT]);
  while (queue.length > 0) {
    const k = queue.shift()!;
    const kids = childrenOf.get(k) ?? [];
    for (const c of kids) {
      const ck = guidStr(c.guid);
      if (seen.has(ck)) {
        continue;
      }
      seen.add(ck);
      descendants.push(c);
      queue.push(ck);
    }
  }
  console.log(`root: ${ROOT}  name=${JSON.stringify(root.name ?? "")}`);
  console.log(`descendants: ${descendants.length}`);

  // Per-type counts.
  const types = new Map<string, number>();
  for (const n of descendants) {
    const t = n.type?.name ?? "<none>";
    types.set(t, (types.get(t) ?? 0) + 1);
  }
  console.log(`\ntype breakdown:`);
  for (const [t, c] of [...types.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(22)} ${c}`);
  }

  // Identify external references on each descendant.
  const externalRefs = new Map<string, Set<string>>();
  const inScope = seen;
  for (const n of descendants) {
    const rec = n as Record<string, unknown>;
    // Style ids
    for (const k of ["fillStyleId", "strokeStyleId", "effectStyleId", "textStyleId", "gridStyleId"]) {
      const v = rec[k];
      if (v !== undefined && v !== 0 && v !== null) {
        const set = externalRefs.get(k) ?? new Set<string>();
        set.add(JSON.stringify(v));
        externalRefs.set(k, set);
      }
    }
    // Variable consumption (likely external)
    if (rec.variableConsumptionMap) {
      externalRefs.set("variableConsumptionMap", new Set(["present"]));
    }
    if (rec.parameterConsumptionMap) {
      externalRefs.set("parameterConsumptionMap", new Set(["present"]));
    }
    // colorVar / strokeVar / cornerRadiusVar inside paints — hard to enumerate without
    // walking fillPaints. Note presence.
    const paints = (rec.fillPaints as Array<Record<string, unknown>> | undefined) ?? [];
    for (const p of paints) {
      if (p.colorVar) {
        const set = externalRefs.get("fillPaints[].colorVar") ?? new Set<string>();
        set.add(JSON.stringify(p.colorVar).slice(0, 60));
        externalRefs.set("fillPaints[].colorVar", set);
      }
    }
    const strokes = (rec.strokePaints as Array<Record<string, unknown>> | undefined) ?? [];
    for (const p of strokes) {
      if (p.colorVar) {
        const set = externalRefs.get("strokePaints[].colorVar") ?? new Set<string>();
        set.add(JSON.stringify(p.colorVar).slice(0, 60));
        externalRefs.set("strokePaints[].colorVar", set);
      }
    }
    // ancestorPathBeforeDeletion may reference outside
    if (rec.ancestorPathBeforeDeletion) {
      externalRefs.set("ancestorPathBeforeDeletion", new Set(["present"]));
    }
    // SYMBOL children reference parent's componentPropDefs via parentPropDefId.
    // Those parentPropDefIds may point at THIS file's own root scope so they should
    // be ok, but let's see them.
    const compPropDefs = rec.componentPropDefs as Array<Record<string, unknown>> | undefined;
    if (compPropDefs) {
      for (const d of compPropDefs) {
        const pid = d.parentPropDefId as Guid | undefined;
        if (pid && !inScope.has(guidStr(pid))) {
          const set = externalRefs.get("childPropDef.parentPropDefId (out-of-scope)") ?? new Set<string>();
          set.add(guidStr(pid));
          externalRefs.set("childPropDef.parentPropDefId (out-of-scope)", set);
        }
      }
    }
    // symbolData.symbolID pointing outside descendant set
    const symData = rec.symbolData as { symbolID?: Guid } | undefined;
    if (symData?.symbolID && !inScope.has(guidStr(symData.symbolID))) {
      const set = externalRefs.get("symbolData.symbolID (out-of-scope)") ?? new Set<string>();
      set.add(guidStr(symData.symbolID));
      externalRefs.set("symbolData.symbolID (out-of-scope)", set);
    }
  }

  console.log(`\nexternal references inside descendant subtree:`);
  if (externalRefs.size === 0) {
    console.log(`  (none — subtree is self-contained!)`);
  } else {
    for (const [k, v] of externalRefs.entries()) {
      console.log(`  ${k}: ${v.size} unique  example=${[...v][0]}`);
    }
  }

  // List descendant guids so we can see scope.
  console.log(`\ndescendant guids:`);
  for (const n of descendants) {
    console.log(`  ${n.type?.name?.padEnd(20)} ${guidStr(n.guid).padEnd(12)}  ${JSON.stringify(n.name ?? "")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
