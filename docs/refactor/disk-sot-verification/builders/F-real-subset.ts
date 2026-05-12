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
import type {
  FigFillGeometry,
  FigNode,
  FigPaint,
  FigVectorData,
  MutableFigNode,
} from "@higma-document-models/fig/types";

const SOURCE = "<DOWNLOADS>/Simple Design System (Community).fig";
const OUT = "docs/refactor/disk-sot-verification/artifacts/F-real-subset.fig";
const ROOT_GUID = "9762:1405"; // Radio Icon

type Guid = { readonly sessionID: number; readonly localID: number };

function guidStr(g: Guid | undefined): string {
  return g ? `${g.sessionID}:${g.localID}` : "<none>";
}

/**
 * Real .fig files attach a `colorVar` slot to paints whose colour
 * resolves from a Figma variable. The slot is non-canonical (not part
 * of the FigPaint contract) and references variables that live in
 * other files, so we drop it before re-serialising.
 */
function stripColorVar(paint: FigPaint): FigPaint {
  // Iterate the paint's own entries and drop the foreign-asset slot.
  // FigPaint is a discriminated union so we can't construct a literal
  // by spreading — recover the union shape from the input fields.
  const entries = Object.entries(paint).filter(([k]) => k !== "colorVar");
  return Object.fromEntries(entries) as FigPaint;
}

/**
 * Fields excluded by `stripExternalRefs`. These are authoring-time
 * metadata that reference state in other files (libraries, edit
 * history, version stream) — keeping them would dangle once the host
 * file is rebuilt without those external sources.
 */
const EXTERNAL_REF_FIELDS = new Set<string>([
  "ancestorPathBeforeDeletion",
  "variableConsumptionMap",
  "parameterConsumptionMap",
  "publishedVersion",
  "version",
  "userFacingVersion",
  "editInfo",
]);

function stripExternalRefs(node: FigNode): FigNode {
  // FigNode carries `[key: string]: unknown` for fields we don't model
  // explicitly. We iterate everything, drop the external-ref slots,
  // and route paint arrays through `stripColorVar`. The result still
  // carries the required `guid`/`phase`/`type` so the FigNode shape is
  // preserved.
  const entries: [string, unknown][] = [];
  for (const [k, v] of Object.entries(node)) {
    if (EXTERNAL_REF_FIELDS.has(k)) {
      continue;
    }
    if (k === "fillPaints" || k === "strokePaints" || k === "backgroundPaints") {
      const arr = v as readonly FigPaint[] | undefined;
      entries.push([k, arr ? arr.map(stripColorVar) : arr]);
      continue;
    }
    entries.push([k, v]);
  }
  // Object.fromEntries widens the value to `unknown`, but the resulting
  // record still carries every FigNode field we copied from the input
  // — including the required `guid`/`phase`/`type`. We assert the
  // FigNode shape on the way out (the structural guarantees come from
  // the source node, not the asserted type).
  return Object.fromEntries(entries) as FigNode;
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
  };

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
  };

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
  const rootSize = cleanedSubtree[0]?.size;
  const lightSize = lightSymbol.size;
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
  };

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
  const collectIdx = (geom: readonly FigFillGeometry[] | undefined): void => {
    if (!geom) {
      return;
    }
    for (const g of geom) {
      if (typeof g.commandsBlob === "number") {
        usedBlobIndices.add(g.commandsBlob);
      }
    }
  };
  for (const n of nodeChanges) {
    collectIdx(n.fillGeometry);
    collectIdx(n.strokeGeometry);
    // vectorData.vectorNetworkBlob is a separate index into the blob stream.
    if (n.vectorData && typeof n.vectorData.vectorNetworkBlob === "number") {
      usedBlobIndices.add(n.vectorData.vectorNetworkBlob);
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
  const remapIdx = (
    geom: readonly FigFillGeometry[] | undefined,
  ): readonly FigFillGeometry[] | undefined => {
    if (!geom) {
      return geom;
    }
    return geom.map((g) => {
      if (typeof g.commandsBlob !== "number") {
        return g;
      }
      const newIdx = oldToNew.get(g.commandsBlob);
      if (newIdx === undefined) {
        throw new Error(`unmapped commandsBlob index ${g.commandsBlob}`);
      }
      return { ...g, commandsBlob: newIdx };
    });
  };
  const remappedNodes: FigNode[] = nodeChanges.map((n) => {
    const out: MutableFigNode = { ...n };
    if (n.fillGeometry) {
      out.fillGeometry = remapIdx(n.fillGeometry);
    }
    if (n.strokeGeometry) {
      out.strokeGeometry = remapIdx(n.strokeGeometry);
    }
    const vd = n.vectorData;
    if (vd && typeof vd.vectorNetworkBlob === "number") {
      const newIdx = oldToNew.get(vd.vectorNetworkBlob);
      if (newIdx !== undefined) {
        const nextVd: FigVectorData = { ...vd, vectorNetworkBlob: newIdx };
        out.vectorData = nextVd;
      }
    }
    return out;
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
