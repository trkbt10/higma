/**
 * Hypothesis-check fixture D:
 *
 *   File C confirmed that componentPropDefs(VARIANT) + variantPropSpecs +
 *   isStateGroup + stateGroupPropertyValueOrders cause Figma to report
 *   "2 Variants" on the parent FRAME — but the parent FRAME wasn't drawn,
 *   and we never tested the switching side (INSTANCE -> variant dropdown).
 *
 *   D fixes the rendering and adds an INSTANCE that switches:
 *     (I)   parent FRAME laid out to actually contain its children
 *           (size big enough, no clipsContent issue)
 *     (II)  child SYMBOLs placed at different local transforms so they
 *           sit side-by-side inside the parent FRAME
 *     (III) one INSTANCE added to the canvas that points at Variant=Solid,
 *           with symbolOverrides shaped after Simple Design System.fig
 *
 *   Output: docs/refactor/disk-sot-verification/artifacts/D-switchable.fig
 */

import { readFile, writeFile } from "node:fs/promises";
import { loadFigFile, saveFigFile, createGuidAllocator } from "@higma-document-io/fig/roundtrip";
import type { FigNode } from "@higma-document-models/fig/domain";

const SOURCE = "packages/@higma-document-renderers/fig/fixtures/components/components.fig";
const OUT = "docs/refactor/disk-sot-verification/artifacts/D-switchable.fig";

type Guid = { readonly sessionID: number; readonly localID: number };

function guidEq(a: Guid | undefined, b: Guid | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  return a.sessionID === b.sessionID && a.localID === b.localID;
}

function guidStr(g: Guid | undefined): string {
  if (!g) {
    return "<none>";
  }
  return `${g.sessionID}:${g.localID}`;
}

async function main(): Promise<void> {
  const bytes = await readFile(SOURCE);
  const loaded = await loadFigFile(new Uint8Array(bytes));

  const buttonSymbol = loaded.nodeChanges.find(
    (n) => n.type?.name === "SYMBOL" && n.name === "Button",
  );
  if (!buttonSymbol?.guid) {
    throw new Error("Button SYMBOL not found");
  }
  const canvasGuid = buttonSymbol.parentIndex?.guid;
  if (!canvasGuid) {
    throw new Error("Button SYMBOL has no parent CANVAS");
  }

  const buttonChildren = loaded.nodeChanges.filter((n) =>
    guidEq(n.parentIndex?.guid, buttonSymbol.guid),
  );

  // Size of the original Button SYMBOL — used for both variants and the new
  // INSTANCE on the canvas.
  const VARIANT_SIZE = buttonSymbol.size ?? { x: 200, y: 50 };
  const GAP = 24;
  const PAD = 24;
  const FRAME_WIDTH = VARIANT_SIZE.x + PAD * 2;
  const FRAME_HEIGHT = VARIANT_SIZE.y * 2 + GAP + PAD * 2;

  const alloc = createGuidAllocator(loaded);
  const newFrameGuid = alloc.next();
  const clonedButtonGuid = alloc.next();
  const propDefGuid = alloc.next();
  const newInstanceGuid = alloc.next();

  // Positions inside CANVAS 0:1.
  // Existing CANVAS children use positions "!" through ")". We append further.
  const newFramePosition = "*";          // Variant Set
  const newInstancePosition = "+";       // demo instance on canvas
  // Inside the new FRAME, two children:
  const variantSolidPosition = "!";
  const variantOutlinePosition = '"';

  // Children of Button were positioned in Button's local space.
  // We keep their parentIndex.guid set to the SYMBOL's guid (which we are
  // moving), so they tag along automatically. They keep their positions
  // inside the symbol — that's local space and doesn't change.

  // The VARIANT property def.
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

  // ---- (I) Parent FRAME: positioned on the canvas, sized to contain both variants, ----
  // ----     with disk metadata that disk SoT requires for a Variant Set.            ----
  const newFrame: FigNode = {
    guid: newFrameGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 4, name: "FRAME" },
    name: "Buttons",
    parentIndex: { guid: canvasGuid, position: newFramePosition },
    transform: { m00: 1, m01: 0, m02: 800, m10: 0, m11: 1, m12: 0 },
    size: { x: FRAME_WIDTH, y: FRAME_HEIGHT },
    isPublishable: true,
    isStateGroup: true,
    componentPropDefs: [variantPropDef],
    stateGroupPropertyValueOrders: [
      { property: "Variant", values: ["Solid", "Outline"] },
    ],
  } as unknown as FigNode;

  // ---- (II) Two variant SYMBOLs sit stacked inside the FRAME ----
  // Original Button (now Variant=Solid) at top.
  // Cloned (Variant=Outline) below it.
  const solidLocalTransform = {
    m00: 1, m01: 0, m02: PAD,
    m10: 0, m11: 1, m12: PAD,
  };
  const outlineLocalTransform = {
    m00: 1, m01: 0, m02: PAD,
    m10: 0, m11: 1, m12: PAD + VARIANT_SIZE.y + GAP,
  };

  const clonedChildren: FigNode[] = buttonChildren.map((child) => {
    if (!child.guid) {
      throw new Error("button child without guid");
    }
    const newGuid = alloc.next();
    return {
      ...child,
      guid: newGuid,
      parentIndex: {
        guid: clonedButtonGuid,
        position: child.parentIndex?.position ?? "!",
      },
    };
  });

  // Rewrite original Button SYMBOL as Variant=Solid inside the new FRAME.
  const rewritten: FigNode[] = loaded.nodeChanges.map((n) => {
    if (n === buttonSymbol) {
      return {
        ...n,
        name: "Variant=Solid",
        parentIndex: { guid: newFrameGuid, position: variantSolidPosition },
        transform: solidLocalTransform,
        variantPropSpecs: [{ propDefId: propDefGuid, value: "Solid" }],
      } as FigNode;
    }
    return n;
  });

  // Cloned SYMBOL as Variant=Outline below Solid.
  const clonedButton: FigNode = {
    ...buttonSymbol,
    guid: clonedButtonGuid,
    name: "Variant=Outline",
    parentIndex: { guid: newFrameGuid, position: variantOutlinePosition },
    transform: outlineLocalTransform,
    variantPropSpecs: [{ propDefId: propDefGuid, value: "Outline" }],
  } as unknown as FigNode;

  // ---- (III) one demo INSTANCE on canvas, pointing at Variant=Solid (buttonSymbol.guid) ----
  // The INSTANCE follows the shape observed in Simple Design System.fig:
  //   symbolData.symbolID = <variant child guid>
  //   symbolData.symbolOverrides = [{ guidPath:{guids:[<same guid>]}, size:{...} }]
  //   symbolData.uniformScaleFactor = 1
  const demoInstance: FigNode = {
    guid: newInstanceGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 16, name: "INSTANCE" },
    name: "Button Demo",
    parentIndex: { guid: canvasGuid, position: newInstancePosition },
    transform: { m00: 1, m01: 0, m02: 800 + FRAME_WIDTH + 80, m10: 0, m11: 1, m12: 0 },
    size: VARIANT_SIZE,
    symbolData: {
      symbolID: buttonSymbol.guid,
      symbolOverrides: [
        {
          guidPath: { guids: [buttonSymbol.guid] },
          size: VARIANT_SIZE,
        },
      ],
      uniformScaleFactor: 1,
    },
  } as unknown as FigNode;

  rewritten.push(newFrame, clonedButton, ...clonedChildren, demoInstance);

  const data = await saveFigFile(
    {
      ...loaded,
      nodeChanges: rewritten,
    },
    { reencodeSchema: true },
  );

  await writeFile(OUT, data);
  console.log(`wrote ${OUT}  (${data.length} bytes)`);
  console.log(`  - new FRAME "Buttons"      guid=${guidStr(newFrameGuid)}  parent=${guidStr(canvasGuid)}`);
  console.log(`    transform: m02=800, m12=0    size: ${FRAME_WIDTH}x${FRAME_HEIGHT}`);
  console.log(`    isStateGroup=true, isPublishable=true`);
  console.log(`    componentPropDefs: 1 VARIANT-typed propDef "Variant" id=${guidStr(propDefGuid)}`);
  console.log(`    stateGroupPropertyValueOrders: Variant -> [Solid, Outline]`);
  console.log(`  - Variant=Solid SYMBOL    guid=${guidStr(buttonSymbol.guid)}  local transform=(${PAD},${PAD})  size=${VARIANT_SIZE.x}x${VARIANT_SIZE.y}`);
  console.log(`    variantPropSpecs: [{ propDefId=${guidStr(propDefGuid)}, value="Solid" }]`);
  console.log(`  - Variant=Outline SYMBOL  guid=${guidStr(clonedButtonGuid)}  local transform=(${PAD},${outlineLocalTransform.m12})  size=${VARIANT_SIZE.x}x${VARIANT_SIZE.y}`);
  console.log(`    variantPropSpecs: [{ propDefId=${guidStr(propDefGuid)}, value="Outline" }]`);
  console.log(`  - Button Demo INSTANCE    guid=${guidStr(newInstanceGuid)}  parent=${guidStr(canvasGuid)}  symbolID=${guidStr(buttonSymbol.guid)} (Variant=Solid)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
