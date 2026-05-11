/**
 * Hypothesis-check fixture F:
 *
 *   The first attempt at F took the Radio Icon variant set and parented it
 *   directly under a fresh single CANVAS, which produced "Internal error
 *   during import" in Figma. Cause: in the source file Radio Icon lives in
 *   "Internal Only Canvas" (visible:false) — Figma's convention for hidden
 *   asset storage. Re-homing it to a visible canvas broke an invariant.
 *
 *   This rebuild keeps Radio Icon's original context: a hidden
 *   "Internal Only Canvas" hosts the variant set, plus a visible
 *   "Workspace" canvas holds the demo INSTANCE. The structure mirrors how
 *   Figma itself organises components: definitions hidden, instances
 *   visible.
 *
 *   Output: docs/refactor/disk-sot-verification/artifacts/F-real-subset.fig
 */

import { readFile, writeFile } from "node:fs/promises";
import { loadFigFile, saveFigFile, createGuidAllocator } from "@higma-document-io/fig/roundtrip";
import type { FigNode } from "@higma-document-models/fig/domain";

const SOURCE = "<DOWNLOADS>/Simple Design System (Community).fig";
const OUT = "docs/refactor/disk-sot-verification/artifacts/F-real-subset.fig";
const ROOT_GUID = "9762:1405"; // Radio Icon

type Guid = { readonly sessionID: number; readonly localID: number };

function guidStr(g: Guid | undefined): string {
  return g ? `${g.sessionID}:${g.localID}` : "<none>";
}

function stripColorVar(paint: Record<string, unknown>): Record<string, unknown> {
  const { colorVar: _drop, ...rest } = paint;
  return rest;
}

function stripExternalRefs(node: FigNode): FigNode {
  const rec = node as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (
      k === "ancestorPathBeforeDeletion" ||
      k === "variableConsumptionMap" ||
      k === "parameterConsumptionMap" ||
      k === "publishedVersion" ||
      k === "version" ||
      k === "userFacingVersion" ||
      k === "editInfo"
    ) {
      continue;
    }
    clean[k] = v;
  }
  const fp = clean.fillPaints as Array<Record<string, unknown>> | undefined;
  if (fp) {
    clean.fillPaints = fp.map(stripColorVar);
  }
  const sp = clean.strokePaints as Array<Record<string, unknown>> | undefined;
  if (sp) {
    clean.strokePaints = sp.map(stripColorVar);
  }
  const bp = clean.backgroundPaints as Array<Record<string, unknown>> | undefined;
  if (bp) {
    clean.backgroundPaints = bp.map(stripColorVar);
  }
  return clean as unknown as FigNode;
}

async function main(): Promise<void> {
  const bytes = await readFile(SOURCE);
  const loaded = await loadFigFile(new Uint8Array(bytes));
  const sourceNodes = loaded.nodeChanges;

  // Child index for subtree extraction.
  const childrenOf = new Map<string, FigNode[]>();
  for (const n of sourceNodes) {
    const p = n.parentIndex?.guid;
    if (p) {
      const k = guidStr(p);
      const list = childrenOf.get(k) ?? [];
      list.push(n);
      childrenOf.set(k, list);
    }
  }

  // BFS-collect Radio Icon subtree.
  const root = sourceNodes.find((n) => guidStr(n.guid) === ROOT_GUID);
  if (!root) {
    throw new Error(`root ${ROOT_GUID} not found in source`);
  }
  const subtree: FigNode[] = [root];
  const queue = [guidStr(root.guid)];
  const seen = new Set<string>([guidStr(root.guid)]);
  while (queue.length > 0) {
    const k = queue.shift()!;
    for (const c of childrenOf.get(k) ?? []) {
      const ck = guidStr(c.guid);
      if (seen.has(ck)) {
        continue;
      }
      seen.add(ck);
      subtree.push(c);
      queue.push(ck);
    }
  }

  // ---- Build host file structure ----
  // DOCUMENT (reuse source 0:0, renamed) + two CANVASes:
  //   - "Internal Only Canvas" (visible: false) — hosts the variant set
  //   - "Workspace" (visible: true)              — hosts the demo INSTANCE
  const sourceDocument = sourceNodes.find((n) => n.type?.name === "DOCUMENT");
  if (!sourceDocument) {
    throw new Error("no DOCUMENT in source");
  }
  const document: FigNode = {
    ...stripExternalRefs(sourceDocument),
    name: "Variant Subset",
  };

  // Reuse the source's actual "Internal Only Canvas" (0:2, visible:false) as the
  // host for Radio Icon. Its name/visibility/parent are correct as-is. Drop any
  // external metadata.
  const sourceHiddenCanvas = sourceNodes.find(
    (n) => n.type?.name === "CANVAS" && n.name === "Internal Only Canvas",
  );
  if (!sourceHiddenCanvas) {
    throw new Error("Internal Only Canvas not found");
  }
  const hiddenCanvas: FigNode = {
    ...stripExternalRefs(sourceHiddenCanvas),
    parentIndex: { guid: document.guid, position: "~" }, // sort it last among canvases
  } as FigNode;

  // Build a brand-new visible canvas with a fresh guid.
  const alloc = createGuidAllocator(loaded);
  const workspaceCanvasGuid = alloc.next();
  const workspaceCanvas: FigNode = {
    guid: workspaceCanvasGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 2, name: "CANVAS" },
    name: "Workspace",
    parentIndex: { guid: document.guid, position: "!" },
    visible: true,
  } as unknown as FigNode;

  // ---- Variant set subtree: keep parent pointing at hiddenCanvas (its real home). ----
  const cleanedSubtree: FigNode[] = subtree.map((n, idx) => {
    const stripped = stripExternalRefs(n);
    if (idx === 0) {
      // The root variant-set FRAME: parent is already hiddenCanvas (0:2),
      // so leave parentIndex alone. Just strip and keep.
      return stripped;
    }
    return stripped;
  });

  // ---- Demo INSTANCE on the visible Workspace, pointing at Shape=Light. ----
  const lightSymbol = cleanedSubtree.find(
    (n) => n.type?.name === "SYMBOL" && n.name === "Shape=Light",
  );
  if (!lightSymbol?.guid) {
    throw new Error("Shape=Light not found");
  }
  const rootSize = (cleanedSubtree[0] as Record<string, unknown>).size as { x: number; y: number } | undefined;
  const lightSize = (lightSymbol as Record<string, unknown>).size as { x: number; y: number } | undefined;
  const demoSize = lightSize ?? rootSize ?? { x: 24, y: 24 };
  const demoInstanceGuid = alloc.next();
  const demoInstance: FigNode = {
    guid: demoInstanceGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 16, name: "INSTANCE" },
    name: "Demo",
    parentIndex: { guid: workspaceCanvasGuid, position: "!" },
    transform: { m00: 1, m01: 0, m02: 100, m10: 0, m11: 1, m12: 100 },
    size: demoSize,
    symbolData: {
      symbolID: lightSymbol.guid,
      symbolOverrides: [
        {
          guidPath: { guids: [lightSymbol.guid] },
          size: demoSize,
        },
      ],
      uniformScaleFactor: 1,
    },
  } as unknown as FigNode;

  const nodeChanges: FigNode[] = [
    document,
    workspaceCanvas,
    hiddenCanvas,
    ...cleanedSubtree,
    demoInstance,
  ];

  // VECTOR / FRAME nodes carry fillGeometry / strokeGeometry entries whose
  // `commandsBlob` field is an index into `loaded.blobs`. Stripping blobs to
  // [] leaves dangling indices and triggers Figma's "Internal error during
  // import". The source file has thousands of blobs; copying the lot causes
  // OOM during reencodeSchema. So: collect only the blob indices our subtree
  // actually references, build a compact blobs array, and rewrite the
  // indices in-place.
  const usedBlobIndices = new Set<number>();
  const collectIdx = (geom: Array<Record<string, unknown>> | undefined) => {
    if (!geom) {
      return;
    }
    for (const g of geom) {
      const idx = g.commandsBlob;
      if (typeof idx === "number") {
        usedBlobIndices.add(idx);
      }
    }
  };
  for (const n of nodeChanges) {
    const r = n as Record<string, unknown>;
    collectIdx(r.fillGeometry as Array<Record<string, unknown>> | undefined);
    collectIdx(r.strokeGeometry as Array<Record<string, unknown>> | undefined);
    // vectorData.network also references blobs (segments stream)
    const vd = r.vectorData as Record<string, unknown> | undefined;
    if (vd) {
      // vectorData may contain `vectorNetworkBlob` index
      const vnb = vd.vectorNetworkBlob;
      if (typeof vnb === "number") {
        usedBlobIndices.add(vnb);
      }
    }
  }
  const oldToNew = new Map<number, number>();
  const compactBlobs: typeof loaded.blobs[number][] = [];
  for (const idx of [...usedBlobIndices].sort((a, b) => a - b)) {
    const b = loaded.blobs[idx];
    if (!b) {
      continue;
    }
    oldToNew.set(idx, compactBlobs.length);
    compactBlobs.push(b);
  }
  // Rewrite commandsBlob / vectorNetworkBlob indices.
  const remapIdx = (geom: Array<Record<string, unknown>> | undefined) => {
    if (!geom) {
      return geom;
    }
    return geom.map((g) => {
      const oldIdx = g.commandsBlob;
      if (typeof oldIdx === "number") {
        const newIdx = oldToNew.get(oldIdx);
        if (newIdx === undefined) {
          throw new Error(`unmapped commandsBlob index ${oldIdx}`);
        }
        return { ...g, commandsBlob: newIdx };
      }
      return g;
    });
  };
  const remappedNodes: FigNode[] = nodeChanges.map((n) => {
    const r = n as Record<string, unknown>;
    const out: Record<string, unknown> = { ...r };
    if (r.fillGeometry) {
      out.fillGeometry = remapIdx(r.fillGeometry as Array<Record<string, unknown>>);
    }
    if (r.strokeGeometry) {
      out.strokeGeometry = remapIdx(r.strokeGeometry as Array<Record<string, unknown>>);
    }
    const vd = r.vectorData as Record<string, unknown> | undefined;
    if (vd && typeof vd.vectorNetworkBlob === "number") {
      const newIdx = oldToNew.get(vd.vectorNetworkBlob as number);
      if (newIdx !== undefined) {
        out.vectorData = { ...vd, vectorNetworkBlob: newIdx };
      }
    }
    return out as unknown as FigNode;
  });

  console.log(`  used blob indices: ${[...usedBlobIndices].sort((a, b) => a - b).join(", ")}`);
  console.log(`  compact blobs:     ${compactBlobs.length} (of ${loaded.blobs.length})`);

  const data = await saveFigFile(
    {
      ...loaded,
      nodeChanges: remappedNodes,
      blobs: compactBlobs,
      images: new Map(),
      metadata: null,
      thumbnail: null,
    },
    { reencodeSchema: true },
  );
  await writeFile(OUT, data);

  console.log(`wrote ${OUT}  (${data.length} bytes)`);
  console.log(`  total nodes: ${nodeChanges.length}`);
  console.log(`  DOCUMENT          guid=${guidStr(document.guid)}  "${document.name}"`);
  console.log(`  CANVAS "Workspace" (visible) guid=${guidStr(workspaceCanvasGuid)}`);
  console.log(`    INSTANCE "Demo"      guid=${guidStr(demoInstanceGuid)}  symbolID=${guidStr(lightSymbol.guid)} (Shape=Light)`);
  console.log(`  CANVAS "Internal Only Canvas" (hidden) guid=${guidStr(hiddenCanvas.guid)}`);
  for (const n of cleanedSubtree) {
    console.log(`    ${n.type?.name?.padEnd(8)} guid=${guidStr(n.guid).padEnd(12)} name=${JSON.stringify(n.name ?? "")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
