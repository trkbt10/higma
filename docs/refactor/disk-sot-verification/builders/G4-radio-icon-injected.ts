/**
 * Diagnostic G4:
 *   Build on G3 (components.fig DOCUMENT + visible CANVAS + hidden CANVAS),
 *   inject the Radio Icon variant set (Simple Design System.fig 9762:1405)
 *   as the child of the hidden CANVAS, and append the blobs it references.
 *
 *   This is "F done with components.fig as the host file" — we keep the host
 *   schema/blobs (proven loadable in G1/G2/G3), then borrow only Radio Icon's
 *   subtree + the geometry blobs it needs.
 */

import { readFile, writeFile } from "node:fs/promises";
import { loadFigFile, saveFigFile, createGuidAllocator } from "@higma-document-io/fig/roundtrip";
import type { FigNode } from "@higma-document-models/fig/domain";

const HOST_PATH = "packages/@higma-document-renderers/fig/fixtures/components/components.fig";
const DONOR_PATH = "<DOWNLOADS>/Simple Design System (Community).fig";
const OUT = "docs/refactor/disk-sot-verification/artifacts/G4-radio-icon-injected.fig";
const RADIO_ICON_GUID = "9762:1405";

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
  for (const arrKey of ["fillPaints", "strokePaints", "backgroundPaints"]) {
    const arr = clean[arrKey] as Array<Record<string, unknown>> | undefined;
    if (arr) {
      clean[arrKey] = arr.map(stripColorVar);
    }
  }
  return clean as unknown as FigNode;
}

async function main(): Promise<void> {
  const hostBytes = await readFile(HOST_PATH);
  const host = await loadFigFile(new Uint8Array(hostBytes));
  const donorBytes = await readFile(DONOR_PATH);
  const donor = await loadFigFile(new Uint8Array(donorBytes));

  // --- subtree collection from donor ---
  const donorChildren = new Map<string, FigNode[]>();
  for (const n of donor.nodeChanges) {
    const p = n.parentIndex?.guid;
    if (p) {
      const k = guidStr(p);
      const list = donorChildren.get(k) ?? [];
      list.push(n);
      donorChildren.set(k, list);
    }
  }
  const radioIcon = donor.nodeChanges.find((n) => guidStr(n.guid) === RADIO_ICON_GUID);
  if (!radioIcon) {
    throw new Error("Radio Icon not found in donor");
  }
  const subtree: FigNode[] = [radioIcon];
  const q = [guidStr(radioIcon.guid)];
  const seen = new Set<string>([guidStr(radioIcon.guid)]);
  while (q.length > 0) {
    const k = q.shift()!;
    for (const c of donorChildren.get(k) ?? []) {
      const ck = guidStr(c.guid);
      if (seen.has(ck)) {
        continue;
      }
      seen.add(ck);
      subtree.push(c);
      q.push(ck);
    }
  }

  // --- host scaffolding (DOCUMENT, visible CANVAS, hidden CANVAS) ---
  const document = host.nodeChanges.find((n) => n.type?.name === "DOCUMENT");
  const visibleCanvas = host.nodeChanges.find((n) => n.type?.name === "CANVAS" && n.name === "Components Canvas");
  if (!document?.guid || !visibleCanvas?.guid) {
    throw new Error("host DOCUMENT/CANVAS not found");
  }
  const alloc = createGuidAllocator(host);
  const hiddenCanvasGuid = alloc.next();
  const hiddenCanvas: FigNode = {
    guid: hiddenCanvasGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 2, name: "CANVAS" },
    name: "Internal Only Canvas",
    parentIndex: { guid: document.guid, position: "~" },
    visible: false,
  } as unknown as FigNode;

  // --- blob remap: collect indices referenced in subtree, append to host blobs ---
  const usedDonorIdx = new Set<number>();
  const collectIdx = (geom: Array<Record<string, unknown>> | undefined) => {
    if (!geom) {
      return;
    }
    for (const g of geom) {
      const idx = g.commandsBlob;
      if (typeof idx === "number") {
        usedDonorIdx.add(idx);
      }
    }
  };
  for (const n of subtree) {
    const r = n as Record<string, unknown>;
    collectIdx(r.fillGeometry as Array<Record<string, unknown>> | undefined);
    collectIdx(r.strokeGeometry as Array<Record<string, unknown>> | undefined);
    const vd = r.vectorData as Record<string, unknown> | undefined;
    if (vd && typeof vd.vectorNetworkBlob === "number") {
      usedDonorIdx.add(vd.vectorNetworkBlob);
    }
  }
  const hostBlobs = [...host.blobs];
  const donorToHostIdx = new Map<number, number>();
  for (const idx of [...usedDonorIdx].sort((a, b) => a - b)) {
    const b = donor.blobs[idx];
    if (!b) {
      throw new Error(`donor blob ${idx} not found`);
    }
    donorToHostIdx.set(idx, hostBlobs.length);
    hostBlobs.push(b);
  }
  const remapGeom = (geom: Array<Record<string, unknown>> | undefined) => {
    if (!geom) {
      return geom;
    }
    return geom.map((g) => {
      const old = g.commandsBlob;
      if (typeof old !== "number") {
        return g;
      }
      const next = donorToHostIdx.get(old);
      if (next === undefined) {
        throw new Error(`unmapped commandsBlob ${old}`);
      }
      return { ...g, commandsBlob: next };
    });
  };

  // --- rewrite subtree: strip external refs, remap blob indices, re-parent root ---
  const cleanedSubtree: FigNode[] = subtree.map((n, idx) => {
    const stripped = stripExternalRefs(n);
    const r = stripped as Record<string, unknown>;
    const out: Record<string, unknown> = { ...r };
    if (r.fillGeometry) {
      out.fillGeometry = remapGeom(r.fillGeometry as Array<Record<string, unknown>>);
    }
    if (r.strokeGeometry) {
      out.strokeGeometry = remapGeom(r.strokeGeometry as Array<Record<string, unknown>>);
    }
    const vd = r.vectorData as Record<string, unknown> | undefined;
    if (vd && typeof vd.vectorNetworkBlob === "number") {
      const next = donorToHostIdx.get(vd.vectorNetworkBlob as number);
      if (next !== undefined) {
        out.vectorData = { ...vd, vectorNetworkBlob: next };
      }
    }
    if (idx === 0) {
      // Root: re-parent under hidden canvas.
      out.parentIndex = { guid: hiddenCanvasGuid, position: "!" };
    }
    return out as unknown as FigNode;
  });

  // --- final node list ---
  const nodeChanges: FigNode[] = [
    document,
    visibleCanvas,
    hiddenCanvas,
    ...cleanedSubtree,
  ];

  const data = await saveFigFile(
    {
      ...host,
      nodeChanges,
      blobs: hostBlobs,
    },
    { reencodeSchema: true },
  );
  await writeFile(OUT, data);
  console.log(`wrote ${OUT}  (${data.length} bytes)`);
  console.log(`  total nodes: ${nodeChanges.length}`);
  console.log(`  host blobs: ${host.blobs.length} -> ${hostBlobs.length} (+${usedDonorIdx.size} from donor)`);
  console.log(`  donor->host blob index map:`, [...donorToHostIdx.entries()]);
  for (const n of cleanedSubtree) {
    console.log(`    ${n.type?.name?.padEnd(8)} guid=${guidStr(n.guid).padEnd(12)} name=${JSON.stringify(n.name ?? "")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
