/**
 * @file Verify the `group-as-variant-set` plan action assembles a
 * FRAME + sibling SYMBOLs with `Prop=Value` names that
 * `isVariantSetFrame` recognises.
 *
 * Strategy: use a fixture with multiple promotable clusters; the
 * `components` fixture has component instances we can rename, but it
 * is simpler to assert on the plan structure than to land a full apply
 * — apply is exercised separately in `proxy-bootstrap.spec.ts`.
 *
 * The variant-set action runs AFTER `promote-icon-cluster`, so the
 * plan layer must emit them in that order. The apply layer threads the
 * promoted SYMBOL GUIDs through internal state.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isVariantSetFrame } from "@higma-document-models/fig/symbols";
import { loadFigFile, saveFigFile } from "@higma-document-io/fig/roundtrip";
import { getNodeType } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import { loadRefineSource } from "../src/refine-source/load";
import type { Inventory, SubtreeClusterEntry, SubtreeMemberRecord } from "../src/inventory";
import type { Decisions } from "../src/decisions";
import { buildPlan } from "../src/plan";
import { applyPlan } from "../src/apply";

const FIXTURES_ROOT = resolve(__dirname, "../../../@higma-document-renderers/fig/fixtures");
const FIXTURE = "rectangle/rectangle.fig";

/**
 * Promotable clusters need real, structurally-identical members in the
 * fixture's nodeChanges. Rectangle.fig has no such repeats. So this
 * spec drives the plan layer alone (no apply) on a synthetic
 * inventory; the apply round-trip is covered by the integration spec
 * that runs against a real promote-eligible fixture.
 */
function makeCluster(id: string, members: readonly { guid: string; name: string }[]): SubtreeClusterEntry {
  const memberRecords: SubtreeMemberRecord[] = members.map((m) => ({
    nodeGuid: m.guid,
    nodeName: m.name,
    width: 100,
    height: 100,
    aHash: "0",
    dHash: "0",
  }));
  return {
    clusterId: id,
    roleSignature: `FRAME<icon>(VECTOR)`,
    structuralSignature: `FRAME(VECTOR)`,
    sizeClass: { width: 100, height: 100 },
    members: memberRecords,
  };
}

describe("buildPlan — group-as-variant-set static checks", () => {
  // Note: the happy-path (plan emission + apply round-trip) is covered
  // by the integration test below against a synthetic fixture whose
  // clusters actually exist in the loaded file. The static checks
  // below need only enough state for the gate to fire.

  it("throws when a variantSet references a cluster that is not promoteToSymbol", async () => {
    const buf = await readFile(resolve(FIXTURES_ROOT, FIXTURE));
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const source = await loadRefineSource(bytes);

    const id = "ace-of-spades";
    const inventory: Inventory = {
      palette: [],
      typography: [],
      subtreeClusters: [makeCluster(id, [{ guid: "100:1", name: "x" }, { guid: "100:2", name: "y" }])],
      geometryClusters: [],
      unrenderable: [],
      layoutHints: [],
    };
    const decisions: Decisions = {
      clusters: { [id]: { name: "Ace" } }, // no promoteToSymbol
      palette: {},
      typography: {},
      variantSets: { Ace: { propertyName: "Suit", variants: { Spades: id } } },
    };

    expect(() => buildPlan(source, inventory, decisions, { file: FIXTURE, bytes: bytes.byteLength })).toThrow(
      /promoteToSymbol/i,
    );
  });

  it("throws when a variantSet references an unknown cluster", async () => {
    const buf = await readFile(resolve(FIXTURES_ROOT, FIXTURE));
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const source = await loadRefineSource(bytes);

    const inventory: Inventory = {
      palette: [],
      typography: [],
      subtreeClusters: [],
      geometryClusters: [],
      unrenderable: [],
      layoutHints: [],
    };
    const decisions: Decisions = {
      clusters: {},
      palette: {},
      typography: {},
      variantSets: { Ace: { propertyName: "Suit", variants: { Spades: "does-not-exist" } } },
    };

    expect(() => buildPlan(source, inventory, decisions, { file: FIXTURE, bytes: bytes.byteLength })).toThrow(
      /unknown cluster/i,
    );
  });

  it("throws when one cluster is cited in two different variant sets", async () => {
    const buf = await readFile(resolve(FIXTURES_ROOT, FIXTURE));
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const source = await loadRefineSource(bytes);

    const id = "shared";
    const inventory: Inventory = {
      palette: [],
      typography: [],
      subtreeClusters: [makeCluster(id, [{ guid: "100:1", name: "x" }, { guid: "100:2", name: "y" }])],
      geometryClusters: [],
      unrenderable: [],
      layoutHints: [],
    };
    const decisions: Decisions = {
      clusters: { [id]: { name: "X", promoteToSymbol: true } },
      palette: {},
      typography: {},
      variantSets: {
        A: { propertyName: "P", variants: { v1: id } },
        B: { propertyName: "Q", variants: { v2: id } },
      },
    };

    expect(() => buildPlan(source, inventory, decisions, { file: FIXTURE, bytes: bytes.byteLength })).toThrow(
      /in more than one variant set/i,
    );
  });
});

describe("applyPlan — group-as-variant-set", () => {
  it("creates a variant-set FRAME whose children are the promoted SYMBOLs with Prop=Value names", async () => {
    // We construct a synthetic file with two FRAMEs whose children are
    // identical-fingerprint VECTORs, so promoteIconCluster has real
    // work to do. Then drive the variant-set action and verify
    // isVariantSetFrame() recognises the result.
    const synthetic = await buildSyntheticFig();

    const source = await loadRefineSource(synthetic.bytes);
    const spadesId = "spades";
    const heartsId = "hearts";
    const inventory: Inventory = {
      palette: [],
      typography: [],
      subtreeClusters: [
        makeCluster(spadesId, [
          { guid: synthetic.spadesExemplar, name: "Spades" },
          { guid: synthetic.spadesCopy, name: "Spades-copy" },
        ]),
        makeCluster(heartsId, [
          { guid: synthetic.heartsExemplar, name: "Hearts" },
          { guid: synthetic.heartsCopy, name: "Hearts-copy" },
        ]),
      ],
      geometryClusters: [],
      unrenderable: [],
      layoutHints: [],
    };
    const decisions: Decisions = {
      clusters: {
        [spadesId]: { name: "Card", promoteToSymbol: true, exemplarGuid: synthetic.spadesExemplar },
        [heartsId]: { name: "Card", promoteToSymbol: true, exemplarGuid: synthetic.heartsExemplar },
      },
      palette: {},
      typography: {},
      variantSets: {
        Card: {
          propertyName: "Suit",
          variants: { Spades: spadesId, Hearts: heartsId },
        },
      },
    };

    const plan = buildPlan(source, inventory, decisions, { file: "synthetic", bytes: synthetic.bytes.byteLength });
    const result = applyPlan(source.loaded, plan, {
      internalCanvasGuid: undefined,
      userCanvasGuid: undefined,
      fillTemplateGuid: undefined,
      textTemplateGuid: undefined,
    });

    const groupSkips = result.skipped.filter((s) => s.action.kind === "group-as-variant-set");
    expect(groupSkips, `variant-set action must not be skipped: ${JSON.stringify(groupSkips)}`).toEqual([]);

    const out = await saveFigFile(source.loaded);
    const reloaded = await loadFigFile(out);
    const frames = reloaded.nodeChanges.filter((n) => getNodeType(n) === "FRAME" && n.name === "Card");
    expect(frames.length, "expected exactly one Card variant-set FRAME").toBe(1);
    const setFrame = frames[0];
    if (!setFrame) {
      throw new Error("missing set frame");
    }
    expect(isVariantSetFrame(setFrame), "produced FRAME must satisfy isVariantSetFrame").toBe(true);

    const setKey = `${setFrame.guid.sessionID}:${setFrame.guid.localID}`;
    const children = reloaded.nodeChanges.filter((n) => {
      const p = n.parentIndex?.guid;
      if (!p) {
        return false;
      }
      return `${p.sessionID}:${p.localID}` === setKey;
    });
    expect(children.length).toBe(2);
    const names = children.map((c) => c.name).sort();
    expect(names).toEqual(["Suit=Hearts", "Suit=Spades"]);
    for (const c of children) {
      expect(getNodeType(c)).toBe("SYMBOL");
    }
  }, 30_000);
});

/**
 * Build a minimal synthetic .fig with two pairs of identical FRAMEs
 * (each pair = one cluster for promotion). Returns the serialised
 * bytes plus the guids the spec needs.
 */
async function buildSyntheticFig(): Promise<{
  readonly bytes: Uint8Array;
  readonly spadesExemplar: string;
  readonly spadesCopy: string;
  readonly heartsExemplar: string;
  readonly heartsCopy: string;
}> {
  // Start from the rectangle fixture and append our synthetic nodes.
  // `LoadedFigFile.nodeChanges` is declared `readonly` post-Phase 3-C
  // (the public contract guarantees no in-place mutation); this spec
  // bypasses the type for fixture construction only — the synthetic
  // tree lives entirely inside the test scope.
  const buf = await readFile(resolve(FIXTURES_ROOT, FIXTURE));
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const loadedReadonly = await loadFigFile(bytes);
  const loaded = loadedReadonly as unknown as Omit<typeof loadedReadonly, "nodeChanges"> & {
    nodeChanges: FigNode[];
  };
  const canvas = loaded.nodeChanges.find((n) => getNodeType(n) === "CANVAS" && n.internalOnly !== true);
  if (!canvas) {
    throw new Error("buildSyntheticFig: no user canvas in rectangle fixture");
  }
  const canvasGuid = canvas.guid;
  // Build two pairs of identical FRAMEs. Each FRAME wraps a single
  // VECTOR child; the VECTORs share an identical paint stack so the
  // promote fingerprint is identical inside each pair.
  const counter = { localID: 0 };
  const nextGuid = (): { sessionID: number; localID: number } => {
    counter.localID = counter.localID + 1;
    return { sessionID: 999, localID: counter.localID };
  };

  function pair(name: string): { exemplar: string; copy: string } {
    const exemplar = nextGuid();
    const exemplarChild = nextGuid();
    const copy = nextGuid();
    const copyChild = nextGuid();
    loaded.nodeChanges.push({
      guid: exemplar,
      phase: { value: 0, name: "CREATED" },
      parentIndex: { guid: canvasGuid, position: `synthetic-${name}-a` },
      type: { value: 4, name: "FRAME" },
      name: `${name}`,
      size: { x: 100, y: 100 },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    });
    loaded.nodeChanges.push({
      guid: exemplarChild,
      phase: { value: 0, name: "CREATED" },
      parentIndex: { guid: exemplar, position: "child-z" },
      type: { value: 6, name: "VECTOR" },
      name: `${name}-glyph`,
      size: { x: 80, y: 80 },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      fillPaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    loaded.nodeChanges.push({
      guid: copy,
      phase: { value: 0, name: "CREATED" },
      parentIndex: { guid: canvasGuid, position: `synthetic-${name}-b` },
      type: { value: 4, name: "FRAME" },
      name: `${name}-copy`,
      size: { x: 100, y: 100 },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    });
    loaded.nodeChanges.push({
      guid: copyChild,
      phase: { value: 0, name: "CREATED" },
      parentIndex: { guid: copy, position: "child-z" },
      type: { value: 6, name: "VECTOR" },
      name: `${name}-glyph`,
      size: { x: 80, y: 80 },
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      fillPaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    return {
      exemplar: `${exemplar.sessionID}:${exemplar.localID}`,
      copy: `${copy.sessionID}:${copy.localID}`,
    };
  }
  const spades = pair("spades");
  const hearts = pair("hearts");
  const out = await saveFigFile(loaded);
  return {
    bytes: out,
    spadesExemplar: spades.exemplar,
    spadesCopy: spades.copy,
    heartsExemplar: hearts.exemplar,
    heartsCopy: hearts.copy,
  };
}
