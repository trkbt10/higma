/**
 * Score every variant set by:
 *  - total descendant count (smaller = better)
 *  - has variableConsumptionMap (1 = bad)
 *  - has fillPaints.colorVar / strokePaints.colorVar references (count)
 *  - INSTANCE in subtree pointing outside (count) — likely fatal
 *
 * Print top 20 candidates by "cleanliness". Goal: find the smallest, most
 * self-contained variant set to extract for file F.
 */

import { readFile } from "node:fs/promises";
import { loadFigFile } from "@higma-document-io/fig/roundtrip";

const PATH = process.env.SDS_FIG_PATH;
if (!PATH) {
  throw new Error("SDS_FIG_PATH must point to `Simple Design System (Community).fig`");
}

type Guid = { readonly sessionID: number; readonly localID: number };
function guidStr(g: Guid | undefined): string {
  return g ? `${g.sessionID}:${g.localID}` : "<none>";
}

async function main(): Promise<void> {
  const bytes = await readFile(PATH);
  const loaded = await loadFigFile(new Uint8Array(bytes));
  const nodes = loaded.nodeChanges;

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

  // index for ancestor walk
  const byGuid = new Map<string, typeof nodes[number]>();
  for (const n of nodes) {
    if (n.guid) {
      byGuid.set(guidStr(n.guid), n);
    }
  }

  // Find variant set parents that live in a *visible* canvas (excluding
  // "Internal Only Canvas" where assets sit in hidden form).
  const variantParents: typeof nodes[number][] = [];
  for (const n of nodes) {
    if (n.type?.name !== "FRAME") {
      continue;
    }
    const defs = (n as Record<string, unknown>).componentPropDefs as
      | Array<{ type?: { name?: string } }>
      | undefined;
    if (!defs || !defs.some((d) => d.type?.name === "VARIANT")) {
      continue;
    }
    // Walk up to canvas, check visibility.
    let cur: typeof nodes[number] | undefined = n;
    let canvas: typeof nodes[number] | undefined;
    while (cur) {
      if (cur.type?.name === "CANVAS") {
        canvas = cur;
        break;
      }
      const p = cur.parentIndex?.guid;
      if (!p) {
        break;
      }
      cur = byGuid.get(guidStr(p));
    }
    if (!canvas) {
      continue;
    }
    const canvasVisible = (canvas as Record<string, unknown>).visible !== false;
    if (!canvasVisible) {
      continue;
    }
    variantParents.push(n);
  }

  type Score = {
    root: typeof nodes[number];
    descendantCount: number;
    typeCounts: Map<string, number>;
    hasVariableMap: boolean;
    colorVarRefs: number;
    outOfScopeSymbolIDs: number;
    childPropDefOutOfScope: number;
  };

  const scores: Score[] = [];
  for (const root of variantParents) {
    const inScope = new Set<string>([guidStr(root.guid)]);
    const queue: string[] = [guidStr(root.guid)];
    const descendants: typeof nodes[number][] = [root];
    while (queue.length > 0) {
      const k = queue.shift()!;
      for (const c of childrenOf.get(k) ?? []) {
        const ck = guidStr(c.guid);
        if (inScope.has(ck)) {
          continue;
        }
        inScope.add(ck);
        descendants.push(c);
        queue.push(ck);
      }
    }
    const typeCounts = new Map<string, number>();
    let hasVariableMap = false;
    let colorVarRefs = 0;
    let outOfScopeSymbolIDs = 0;
    let childPropDefOutOfScope = 0;
    for (const n of descendants) {
      const t = n.type?.name ?? "<none>";
      typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
      const rec = n as Record<string, unknown>;
      if (rec.variableConsumptionMap) {
        hasVariableMap = true;
      }
      const fps = (rec.fillPaints as Array<Record<string, unknown>> | undefined) ?? [];
      for (const p of fps) {
        if (p.colorVar) {
          colorVarRefs += 1;
        }
      }
      const sps = (rec.strokePaints as Array<Record<string, unknown>> | undefined) ?? [];
      for (const p of sps) {
        if (p.colorVar) {
          colorVarRefs += 1;
        }
      }
      const symData = rec.symbolData as { symbolID?: Guid } | undefined;
      if (symData?.symbolID && !inScope.has(guidStr(symData.symbolID))) {
        outOfScopeSymbolIDs += 1;
      }
      const cpdfs = rec.componentPropDefs as Array<{ parentPropDefId?: Guid }> | undefined;
      if (cpdfs) {
        for (const d of cpdfs) {
          if (d.parentPropDefId && !inScope.has(guidStr(d.parentPropDefId))) {
            childPropDefOutOfScope += 1;
          }
        }
      }
    }
    scores.push({
      root,
      descendantCount: descendants.length,
      typeCounts,
      hasVariableMap,
      colorVarRefs,
      outOfScopeSymbolIDs,
      childPropDefOutOfScope,
    });
  }

  // Sort: cleanest first.
  // Priority: minimise outOfScopeSymbolIDs + childPropDefOutOfScope (hard to fix),
  // then minimise variableMap + colorVarRefs (easy to strip), then minimise size.
  scores.sort((a, b) => {
    const aH = a.outOfScopeSymbolIDs + a.childPropDefOutOfScope;
    const bH = b.outOfScopeSymbolIDs + b.childPropDefOutOfScope;
    if (aH !== bH) {
      return aH - bH;
    }
    const aS = (a.hasVariableMap ? 1000 : 0) + a.colorVarRefs;
    const bS = (b.hasVariableMap ? 1000 : 0) + b.colorVarRefs;
    if (aS !== bS) {
      return aS - bS;
    }
    return a.descendantCount - b.descendantCount;
  });

  console.log(`variant sets ranked by cleanliness (top 20):`);
  for (const s of scores.slice(0, 20)) {
    const ts = [...s.typeCounts.entries()].map(([t, c]) => `${t}=${c}`).join(",");
    console.log(
      `  ${guidStr(s.root.guid).padEnd(12)}  name=${JSON.stringify(s.root.name ?? "").padEnd(28)}` +
      `  desc=${String(s.descendantCount).padStart(3)}  types=${ts.padEnd(40)}` +
      `  oos-symbol=${s.outOfScopeSymbolIDs}  oos-propdef=${s.childPropDefOutOfScope}` +
      `  varMap=${s.hasVariableMap ? "Y" : "."}  colorVar=${s.colorVarRefs}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
