/**
 * Hypothesis-check fixture B:
 *
 *   The SoT (`.fig` Kiwi binary) has no COMPONENT_SET NodeType. The hypothesis
 *   is that a Component Set is encoded on disk as a plain FRAME whose direct
 *   SYMBOL children carry `Prop=Value` names (the existing `hasVariantSiblings`
 *   detector in this repo already reads .fig files this way).
 *
 *   This file tests the hypothesis at its minimum form: just naming + parent
 *   structure, no `componentPropertyDefs` / `variantPropSpecs`. If Figma
 *   recognises this as a Variant Set on load, the hypothesis is confirmed
 *   for the naming-only case. If not, we know additional Kiwi-level structure
 *   is required.
 *
 * Procedure:
 *  - load components.fig (real Figma export)
 *  - clone the "Button" SYMBOL (guid 1:10) and its two children ("bg" 1:11,
 *    "label" 1:12) under fresh GUIDs in a fresh sessionID
 *  - insert a new FRAME "Buttons" as the last child of the "Components Canvas"
 *  - reparent the original Button SYMBOL into the new FRAME, rename it
 *    "Variant=Solid"
 *  - reparent the cloned Button SYMBOL into the new FRAME, rename it
 *    "Variant=Outline"
 *  - existing INSTANCE references to Button (1:10) keep working (symbolID
 *    untouched)
 *
 * Output: docs/refactor/disk-sot-verification/artifacts/B-naming-only.fig
 */

import { readFile, writeFile } from "node:fs/promises";
import { loadFigFile, saveFigFile, createGuidAllocator } from "@higma-document-io/fig/roundtrip";
import type { FigNode } from "@higma-document-models/fig/domain";

const SOURCE = "packages/@higma-document-renderers/fig/fixtures/components/components.fig";
const OUT = "docs/refactor/disk-sot-verification/artifacts/B-naming-only.fig";

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

  // Collect direct children of Button (bg, label) — to deep-clone.
  const buttonChildren = loaded.nodeChanges.filter((n) => guidEq(n.parentIndex?.guid, buttonSymbol.guid));

  // Fresh GUID allocator (new sessionID, no clash with anything in the file).
  const alloc = createGuidAllocator(loaded);
  const newFrameGuid = alloc.next();
  const clonedButtonGuid = alloc.next();

  // ParentIndex positions: the new FRAME goes after every existing CANVAS child.
  // Existing positions under canvas 0:1 are "!"<"\""<"#"<...<")". Use "*" (next char) for the new frame.
  const newFramePosition = "*";

  // Two SYMBOL variants share the new FRAME. Use "!" and "\"" inside the frame.
  const variantSolidPosition = "!";
  const variantOutlinePosition = '"';

  const newFrame: FigNode = {
    guid: newFrameGuid,
    phase: { value: 0, name: "CREATED" },
    type: { value: 4, name: "FRAME" },
    name: "Buttons",
    parentIndex: { guid: canvasGuid, position: newFramePosition },
    transform: { m00: 1, m01: 0, m02: 600, m10: 0, m11: 1, m12: 0 },
    size: { x: 400, y: 200 },
  };

  // Build cloned children for the cloned Button SYMBOL. Each child gets a new
  // GUID and points at clonedButtonGuid as parent.
  const childGuidMap = new Map<string, Guid>();
  for (const child of buttonChildren) {
    if (!child.guid) {
      continue;
    }
    childGuidMap.set(guidStr(child.guid), alloc.next());
  }
  const clonedChildren: FigNode[] = buttonChildren.map((child) => {
    if (!child.guid) {
      throw new Error("button child without guid");
    }
    const newGuid = childGuidMap.get(guidStr(child.guid))!;
    return {
      ...child,
      guid: newGuid,
      parentIndex: { guid: clonedButtonGuid, position: child.parentIndex?.position ?? "!" },
    };
  });

  // Rewrite nodeChanges:
  //   - original Button: parent -> new FRAME, name -> "Variant=Solid"
  //   - everything else (including Button children, which still reference Button's guid as parent) untouched
  const rewritten: FigNode[] = loaded.nodeChanges.map((n) => {
    if (n === buttonSymbol) {
      return {
        ...n,
        name: "Variant=Solid",
        parentIndex: { guid: newFrameGuid, position: variantSolidPosition },
      };
    }
    return n;
  });

  // Append the new FRAME and the cloned SYMBOL + its children.
  const clonedButton: FigNode = {
    ...buttonSymbol,
    guid: clonedButtonGuid,
    name: "Variant=Outline",
    parentIndex: { guid: newFrameGuid, position: variantOutlinePosition },
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
  console.log(`  - new FRAME "Buttons" at parent=${guidStr(canvasGuid)} guid=${guidStr(newFrameGuid)}`);
  console.log(`  - original Button SYMBOL  guid=${guidStr(buttonSymbol.guid)}  ->  parent=${guidStr(newFrameGuid)}, name="Variant=Solid"`);
  console.log(`  - cloned Button SYMBOL    guid=${guidStr(clonedButtonGuid)}  ->  parent=${guidStr(newFrameGuid)}, name="Variant=Outline"`);
  console.log(`  - cloned children: ${clonedChildren.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
