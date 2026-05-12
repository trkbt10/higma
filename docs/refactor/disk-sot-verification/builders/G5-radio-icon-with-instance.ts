/**
 * Diagnostic G5:
 *   G4 + a Demo INSTANCE on the visible CANVAS pointing at Shape=Light.
 *   This is the original F goal, but built on top of components.fig (which
 *   G1/G2/G3/G4 proved to be a healthy host) instead of Simple Design
 *   System.fig (where F was sourced from and failed).
 *
 *   If this opens in Figma, we've reached the SoT-verified switchable
 *   variant case. The Variant=Light/Dark/Mid options should be selectable
 *   from the Demo INSTANCE's Properties panel.
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

const HOST_PATH = "packages/@higma-document-renderers/fig/fixtures/components/components.fig";
const DONOR_PATH = "<DOWNLOADS>/Simple Design System (Community).fig";
const OUT = "docs/refactor/disk-sot-verification/artifacts/G5-radio-icon-with-instance.fig";
const RADIO_ICON_GUID = "9762:1405";

type Guid = { readonly sessionID: number; readonly localID: number };
function guidStr(g: Guid | undefined): string {
  return g ? `${g.sessionID}:${g.localID}` : "<none>";
}

/**
 * Real .fig files attach a `colorVar` slot to paints whose colour
 * resolves from a Figma variable. The slot is non-canonical (not part
 * of the FigPaint contract) and references variables in other files,
 * so we drop it before re-serialising.
 */
function stripColorVar(paint: FigPaint): FigPaint {
  const entries = Object.entries(paint).filter(([k]) => k !== "colorVar");
  return Object.fromEntries(entries) as FigPaint;
}

/**
 * Fields excluded by `stripExternalRefs`: authoring-time metadata that
 * references state in other files (libraries, edit history, version
 * stream). Keeping them would dangle once the host file is rebuilt
 * without those external sources.
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
  return Object.fromEntries(entries) as FigNode;
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

  // --- host scaffolding ---
  const document = host.nodeChanges.find((n) => n.type?.name === "DOCUMENT");
  const visibleCanvas = host.nodeChanges.find(
    (n) => n.type?.name === "CANVAS" && n.name === "Components Canvas",
  );
  if (!document?.guid || !visibleCanvas?.guid) {
    throw new Error("host DOCUMENT/CANVAS not found");
  }
  const alloc = createGuidAllocator(host);
  const hiddenCanvasGuid = alloc.next();
  const demoInstanceGuid = alloc.next();
  const hiddenCanvas: FigNode = {
    guid: hiddenCanvasGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 2, name: "CANVAS" },
    name: "Internal Only Canvas",
    parentIndex: { guid: document.guid, position: "~" },
    visible: false,
  };

  // --- blob remap ---
  const usedDonorIdx = new Set<number>();
  const collectIdx = (geom: readonly FigFillGeometry[] | undefined): void => {
    if (!geom) {
      return;
    }
    for (const g of geom) {
      if (typeof g.commandsBlob === "number") {
        usedDonorIdx.add(g.commandsBlob);
      }
    }
  };
  for (const n of subtree) {
    collectIdx(n.fillGeometry);
    collectIdx(n.strokeGeometry);
    if (n.vectorData && typeof n.vectorData.vectorNetworkBlob === "number") {
      usedDonorIdx.add(n.vectorData.vectorNetworkBlob);
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
  const remapGeom = (
    geom: readonly FigFillGeometry[] | undefined,
  ): readonly FigFillGeometry[] | undefined => {
    if (!geom) {
      return geom;
    }
    return geom.map((g) => {
      if (typeof g.commandsBlob !== "number") {
        return g;
      }
      const next = donorToHostIdx.get(g.commandsBlob);
      if (next === undefined) {
        throw new Error(`unmapped commandsBlob ${g.commandsBlob}`);
      }
      return { ...g, commandsBlob: next };
    });
  };

  // --- rewrite subtree ---
  const cleanedSubtree: FigNode[] = subtree.map((n, idx) => {
    const stripped = stripExternalRefs(n);
    const out: MutableFigNode = { ...stripped };
    if (stripped.fillGeometry) {
      out.fillGeometry = remapGeom(stripped.fillGeometry);
    }
    if (stripped.strokeGeometry) {
      out.strokeGeometry = remapGeom(stripped.strokeGeometry);
    }
    const vd = stripped.vectorData;
    if (vd && typeof vd.vectorNetworkBlob === "number") {
      const next = donorToHostIdx.get(vd.vectorNetworkBlob);
      if (next !== undefined) {
        const nextVd: FigVectorData = { ...vd, vectorNetworkBlob: next };
        out.vectorData = nextVd;
      }
    }
    if (idx === 0) {
      out.parentIndex = { guid: hiddenCanvasGuid, position: "!" };
    }
    return out;
  });

  // --- demo INSTANCE pointing at Shape=Light ---
  const lightSymbol = cleanedSubtree.find(
    (n) => n.type?.name === "SYMBOL" && n.name === "Shape=Light",
  );
  if (!lightSymbol?.guid) {
    throw new Error("Shape=Light not found");
  }
  const demoSize = lightSymbol.size ?? { x: 24, y: 24 };
  const demoInstance: FigNode = {
    guid: demoInstanceGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 16, name: "INSTANCE" },
    name: "Demo",
    parentIndex: { guid: visibleCanvas.guid, position: "*" },
    transform: { m00: 1, m01: 0, m02: 600, m10: 0, m11: 1, m12: 80 },
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

  // host nodeChanges (DOCUMENT, visible CANVAS) + the rest as-is so the existing
  // Button/Card/Icon stay on the canvas (proven safe by G1), plus our additions.
  // To minimise noise, we only keep the 2 root nodes plus our injection.
  const nodeChanges: FigNode[] = [
    document,
    visibleCanvas,
    hiddenCanvas,
    ...cleanedSubtree,
    demoInstance,
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
  console.log(`  host blobs: ${host.blobs.length} -> ${hostBlobs.length}`);
  console.log(`  visible CANVAS                guid=${guidStr(visibleCanvas.guid)}`);
  console.log(`    INSTANCE "Demo"             guid=${guidStr(demoInstanceGuid)}  symbolID=${guidStr(lightSymbol.guid)}`);
  console.log(`  hidden CANVAS "Internal Only" guid=${guidStr(hiddenCanvasGuid)}`);
  for (const n of cleanedSubtree) {
    console.log(`    ${n.type?.name?.padEnd(8)} guid=${guidStr(n.guid).padEnd(12)} name=${JSON.stringify(n.name ?? "")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
