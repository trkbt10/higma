/**
 * Hypothesis-check fixture C:
 *
 *   File B (FRAME + sibling SYMBOLs with Prop=Value names only) opened in
 *   Figma but did not render and was not recognised as a Variant Set. This
 *   confirmed that the naming convention is decorative, not load-bearing.
 *
 *   File C tries the full SoT shape observed in Simple Design System.fig:
 *     - parent FRAME has `componentPropDefs` with a VARIANT-typed prop
 *     - parent FRAME has `isStateGroup: true`, `isPublishable: true`
 *     - parent FRAME has `stateGroupPropertyValueOrders` listing every value
 *     - each child SYMBOL has `variantPropSpecs` pointing at that propDef
 *
 *   Built on top of components.fig, same approach as file B: keep "Button"
 *   SYMBOL (guid 1:10), clone one variant as a sibling, parent both under a
 *   new FRAME. Difference vs B: the FRAME and SYMBOLs carry the full Kiwi
 *   structure that real .fig Variant Sets have.
 *
 * Output: docs/refactor/disk-sot-verification/artifacts/C-with-propdefs.fig
 */

import { readFile, writeFile } from "node:fs/promises";
import { loadFigFile, saveFigFile, createGuidAllocator } from "@higma-document-io/fig/roundtrip";
import type { FigNode } from "@higma-document-models/fig/types";

const SOURCE = "packages/@higma-document-renderers/fig/fixtures/components/components.fig";
const OUT = "docs/refactor/disk-sot-verification/artifacts/C-with-propdefs.fig";

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

  const alloc = createGuidAllocator(loaded);
  const newFrameGuid = alloc.next();
  const clonedButtonGuid = alloc.next();
  const propDefGuid = alloc.next();

  const newFramePosition = "*"; // last in CANVAS 0:1
  const variantSolidPosition = "!";
  const variantOutlinePosition = '"';

  // Deep-clone Button's direct children under the cloned variant.
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

  // The VARIANT-typed property definition that lives on the parent FRAME.
  // Shape derived from Simple Design System.fig:
  //   - type: { value: 4, name: "VARIANT" }
  //   - initialValue: {}
  //   - varValue uses { textValue: "" } / dataType STRING (value 2)
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

  // The parent FRAME — the "Variant Set" disk encoding.
  const newFrame: FigNode = {
    guid: newFrameGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 4, name: "FRAME" },
    name: "Buttons",
    parentIndex: { guid: canvasGuid, position: newFramePosition },
    transform: { m00: 1, m01: 0, m02: 600, m10: 0, m11: 1, m12: 0 },
    size: { x: 400, y: 200 },
    isPublishable: true,
    isStateGroup: true,
    componentPropDefs: [variantPropDef],
    stateGroupPropertyValueOrders: [
      { property: "Variant", values: ["Solid", "Outline"] },
    ],
  };

  // Rewrite the existing Button SYMBOL to be the "Solid" variant.
  const rewritten: FigNode[] = loaded.nodeChanges.map((n) => {
    if (n === buttonSymbol) {
      return {
        ...n,
        name: "Variant=Solid",
        parentIndex: { guid: newFrameGuid, position: variantSolidPosition },
        variantPropSpecs: [{ propDefId: propDefGuid, value: "Solid" }],
      } as FigNode;
    }
    return n;
  });

  // The cloned SYMBOL is the "Outline" variant.
  const clonedButton: FigNode = {
    ...buttonSymbol,
    guid: clonedButtonGuid,
    name: "Variant=Outline",
    parentIndex: { guid: newFrameGuid, position: variantOutlinePosition },
    variantPropSpecs: [{ propDefId: propDefGuid, value: "Outline" }],
  };

  rewritten.push(newFrame, clonedButton, ...clonedChildren);

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
  console.log(`    componentPropDefs: 1 VARIANT-typed propDef "Variant" with id=${guidStr(propDefGuid)}`);
  console.log(`    isStateGroup=true, isPublishable=true`);
  console.log(`    stateGroupPropertyValueOrders: Variant -> [Solid, Outline]`);
  console.log(`  - existing Button SYMBOL    guid=${guidStr(buttonSymbol.guid)}  ->  Variant=Solid`);
  console.log(`    variantPropSpecs: [{ propDefId=${guidStr(propDefGuid)}, value="Solid" }]`);
  console.log(`  - cloned Button SYMBOL      guid=${guidStr(clonedButtonGuid)}  ->  Variant=Outline`);
  console.log(`    variantPropSpecs: [{ propDefId=${guidStr(propDefGuid)}, value="Outline" }]`);
  console.log(`  - cloned children: ${clonedChildren.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
