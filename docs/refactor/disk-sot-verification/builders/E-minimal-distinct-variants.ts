/**
 * Hypothesis-check fixture E:
 *
 *   Files A–D were built by patching components.fig in place, which left
 *   30+ unrelated nodes on the canvas as noise. The two variants in D were
 *   visually identical, so a Variant switch on the demo INSTANCE could not
 *   be confirmed visually.
 *
 *   E is built from the same components.fig source ONLY to reuse its valid
 *   Kiwi schema and existing DOCUMENT/CANVAS pair; every other node is
 *   discarded. The canvas ends up holding two roots:
 *     1. one Variant Set FRAME "Button" with two visually distinct
 *        variants (filled blue vs blue outline)
 *     2. one INSTANCE "Demo" pointing at the Solid variant
 *
 *   This is the minimum reproduction of a switchable variant. Toggling the
 *   demo INSTANCE's variant should produce a visible change.
 *
 *   Output: docs/refactor/disk-sot-verification/artifacts/E-minimal-distinct-variants.fig
 */

import { readFile, writeFile } from "node:fs/promises";
import { loadFigFile, saveFigFile, createGuidAllocator } from "@higma-document-io/fig/roundtrip";
import type { FigColor, FigNode, FigPaint } from "@higma-document-models/fig/types";
import type { TextData } from "@higma-document-models/fig/domain";

const SOURCE = "packages/@higma-document-renderers/fig/fixtures/components/components.fig";
const OUT = "docs/refactor/disk-sot-verification/artifacts/E-minimal-distinct-variants.fig";

type Guid = { readonly sessionID: number; readonly localID: number };

function guidStr(g: Guid | undefined): string {
  return g ? `${g.sessionID}:${g.localID}` : "<none>";
}

const BLUE: FigColor = { r: 0.13, g: 0.36, b: 0.96, a: 1 };
const WHITE: FigColor = { r: 1, g: 1, b: 1, a: 1 };

function solidFill(color: FigColor): FigPaint {
  return {
    type: "SOLID",
    color,
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

function solidStroke(color: FigColor): FigPaint {
  return {
    type: "SOLID",
    color,
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

/**
 * Build the per-TEXT `textData` payload. Text colour is encoded at the
 * FigNode level via `fillPaints` (see Figma's canonical schema), not on
 * the `textData` value — so this helper takes only the typography
 * settings. Callers add `fillPaints: [solidFill(color)]` on the TEXT
 * node directly.
 */
function textData(characters: string, sizePx = 16): TextData {
  return {
    characters,
    fontSize: sizePx,
    fontName: { family: "Inter", style: "Semi Bold", postscript: "Inter-SemiBold" },
    textAlignHorizontal: { value: 1, name: "CENTER" },
    textAlignVertical: { value: 1, name: "CENTER" },
  };
}

async function main(): Promise<void> {
  const bytes = await readFile(SOURCE);
  const loaded = await loadFigFile(new Uint8Array(bytes));

  // Reuse only the DOCUMENT (guid 0:0) and the first CANVAS (guid 0:1).
  const document = loaded.nodeChanges.find((n) => n.type?.name === "DOCUMENT");
  const canvas = loaded.nodeChanges.find(
    (n) => n.type?.name === "CANVAS" && n.name === "Components Canvas",
  );
  if (!document || !canvas) {
    throw new Error("source DOCUMENT/CANVAS not found");
  }
  // Rename the canvas so the file's intent is obvious in Figma.
  const renamedCanvas: FigNode = { ...canvas, name: "Variant Switch Demo" };

  const alloc = createGuidAllocator(loaded);
  const setFrameGuid = alloc.next();
  const propDefGuid = alloc.next();
  const solidSymbolGuid = alloc.next();
  const solidBgGuid = alloc.next();
  const solidLabelGuid = alloc.next();
  const outlineSymbolGuid = alloc.next();
  const outlineBgGuid = alloc.next();
  const outlineLabelGuid = alloc.next();
  const demoInstanceGuid = alloc.next();

  // Geometry constants.
  const PAD = 16;
  const VARIANT_W = 168;
  const VARIANT_H = 40;
  const GAP = 16;
  const FRAME_W = VARIANT_W + PAD * 2;
  const FRAME_H = VARIANT_H * 2 + GAP + PAD * 2;
  const CORNER = 8;

  // ---- Variant Set parent FRAME ----
  const variantPropDef = {
    id: propDefGuid,
    name: "Variant",
    initialValue: {},
    sortPosition: '"',
    type: { value: 4, name: "VARIANT" as const },
    preferredValues: {},
    varValue: {
      value: { textValue: "" },
      dataType: { value: 2, name: "STRING" as const },
      resolvedDataType: { value: 2, name: "STRING" as const },
    },
  };

  const setFrame: FigNode = {
    guid: setFrameGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 4, name: "FRAME" },
    name: "Button",
    parentIndex: { guid: canvas.guid, position: "!" },
    transform: { m00: 1, m01: 0, m02: 80, m10: 0, m11: 1, m12: 80 },
    size: { x: FRAME_W, y: FRAME_H },
    fillPaints: [solidFill({ r: 0.97, g: 0.97, b: 0.97, a: 1 })],
    isPublishable: true,
    isStateGroup: true,
    componentPropDefs: [variantPropDef],
    stateGroupPropertyValueOrders: [
      { property: "Variant", values: ["Solid", "Outline"] },
    ],
  };

  // ---- Variant=Solid: blue filled button ----
  const solidSymbol: FigNode = {
    guid: solidSymbolGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 15, name: "SYMBOL" },
    name: "Variant=Solid",
    parentIndex: { guid: setFrameGuid, position: "!" },
    transform: { m00: 1, m01: 0, m02: PAD, m10: 0, m11: 1, m12: PAD },
    size: { x: VARIANT_W, y: VARIANT_H },
    variantPropSpecs: [{ propDefId: propDefGuid, value: "Solid" }],
  };

  const solidBg: FigNode = {
    guid: solidBgGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 12, name: "ROUNDED_RECTANGLE" },
    name: "bg",
    parentIndex: { guid: solidSymbolGuid, position: "!" },
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: { x: VARIANT_W, y: VARIANT_H },
    fillPaints: [solidFill(BLUE)],
    cornerRadius: CORNER,
  };

  const solidLabel: FigNode = {
    guid: solidLabelGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 13, name: "TEXT" },
    name: "label",
    parentIndex: { guid: solidSymbolGuid, position: '"' },
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: { x: VARIANT_W, y: VARIANT_H },
    fillPaints: [solidFill(WHITE)],
    textData: textData("Solid"),
  };

  // ---- Variant=Outline: blue outlined button, transparent fill ----
  const outlineSymbol: FigNode = {
    guid: outlineSymbolGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 15, name: "SYMBOL" },
    name: "Variant=Outline",
    parentIndex: { guid: setFrameGuid, position: '"' },
    transform: { m00: 1, m01: 0, m02: PAD, m10: 0, m11: 1, m12: PAD + VARIANT_H + GAP },
    size: { x: VARIANT_W, y: VARIANT_H },
    variantPropSpecs: [{ propDefId: propDefGuid, value: "Outline" }],
  };

  const outlineBg: FigNode = {
    guid: outlineBgGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 12, name: "ROUNDED_RECTANGLE" },
    name: "bg",
    parentIndex: { guid: outlineSymbolGuid, position: "!" },
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: { x: VARIANT_W, y: VARIANT_H },
    fillPaints: [solidFill(WHITE)],
    strokePaints: [solidStroke(BLUE)],
    strokeWeight: 2,
    strokeAlign: "INSIDE",
    cornerRadius: CORNER,
  };

  const outlineLabel: FigNode = {
    guid: outlineLabelGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 13, name: "TEXT" },
    name: "label",
    parentIndex: { guid: outlineSymbolGuid, position: '"' },
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: { x: VARIANT_W, y: VARIANT_H },
    fillPaints: [solidFill(BLUE)],
    textData: textData("Outline"),
  };

  // ---- Demo INSTANCE on canvas, pointing at the Solid variant ----
  const demoInstance: FigNode = {
    guid: demoInstanceGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 16, name: "INSTANCE" },
    name: "Demo",
    parentIndex: { guid: canvas.guid, position: '"' },
    transform: { m00: 1, m01: 0, m02: 80 + FRAME_W + 80, m10: 0, m11: 1, m12: 80 },
    size: { x: VARIANT_W, y: VARIANT_H },
    symbolData: {
      symbolID: solidSymbolGuid,
      symbolOverrides: [
        {
          guidPath: { guids: [solidSymbolGuid] },
          size: { x: VARIANT_W, y: VARIANT_H },
        },
      ],
      uniformScaleFactor: 1,
    },
  };

  const nodeChanges: FigNode[] = [
    document,
    renamedCanvas,
    setFrame,
    solidSymbol,
    solidBg,
    solidLabel,
    outlineSymbol,
    outlineBg,
    outlineLabel,
    demoInstance,
  ];

  const data = await saveFigFile(
    {
      ...loaded,
      nodeChanges,
    },
    { reencodeSchema: true },
  );

  await writeFile(OUT, data);
  console.log(`wrote ${OUT}  (${data.length} bytes)`);
  console.log(`  total nodes: ${nodeChanges.length}`);
  console.log(`  DOCUMENT             guid=${guidStr(document.guid)}`);
  console.log(`  CANVAS               guid=${guidStr(canvas.guid)}  "Variant Switch Demo"`);
  console.log(`  FRAME "Button"       guid=${guidStr(setFrameGuid)}  size=${FRAME_W}x${FRAME_H}  isStateGroup=true`);
  console.log(`    propDef "Variant"  id=${guidStr(propDefGuid)}  type=VARIANT`);
  console.log(`    Variant=Solid      guid=${guidStr(solidSymbolGuid)}  bg=BLUE(filled)        label="Solid"`);
  console.log(`    Variant=Outline    guid=${guidStr(outlineSymbolGuid)}  bg=WHITE,stroke=BLUE  label="Outline"`);
  console.log(`  INSTANCE "Demo"      guid=${guidStr(demoInstanceGuid)}  symbolID=${guidStr(solidSymbolGuid)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
