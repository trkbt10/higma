/**
 * @file Pin the SECTION-grouped SYMBOL resolution invariant.
 *
 * Real-world Figma community templates (the App Store iOS/iPadOS/
 * visionOS Community template is the canonical example) place
 * reusable SYMBOLs under SECTION groupings in the Layers panel. The
 * emitter must surface these as registry component targets when an
 * INSTANCE on a target frame points at them — otherwise the JSX
 * emitter loses the `<Component />` import and falls back to an
 * inline placeholder.
 *
 * SECTIONs do not appear as registry targets themselves but their
 * descendants do.
 *
 */
import type { FigNode, FigGuid, FigParentIndex, KiwiEnumValue, FigKiwiSymbolOverride, FigNodeType } from "@higma-document-models/fig/types";
import { guidToString } from "@higma-document-models/fig/domain";
import type { FigDocumentContext } from "@higma-document-io/fig/context";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig/context";
import { buildRegistry } from "./registry";
import { listFrameTargets } from "./targets";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function makeGuid(sessionID: number, localID: number): FigGuid {
  return { sessionID, localID };
}

function makeParentIndex(parent: FigGuid): FigParentIndex {
  return { guid: parent, position: "V" } as FigParentIndex;
}

function makeSymbolData(options: {
  readonly symbolID?: FigGuid;
  readonly symbolOverrides?: readonly FigKiwiSymbolOverride[];
}): FigNode["symbolData"] | undefined {
  if (options.symbolID === undefined && options.symbolOverrides === undefined) {
    return undefined;
  }
  const symbolData: {
    symbolID?: FigGuid;
    symbolOverrides?: readonly FigKiwiSymbolOverride[];
  } = {};
  if (options.symbolID !== undefined) {
    symbolData.symbolID = options.symbolID;
  }
  if (options.symbolOverrides !== undefined) {
    symbolData.symbolOverrides = options.symbolOverrides;
  }
  return symbolData;
}

function makeNode(
  typeName: FigNodeType,
  name: string,
  guid: FigGuid,
  options: {
    readonly parent?: FigGuid;
    readonly children?: readonly FigNode[];
    readonly symbolID?: FigGuid;
    readonly symbolOverrides?: readonly FigKiwiSymbolOverride[];
  } = {},
): FigNode {
  const symbolData = makeSymbolData(options);
  return {
    guid,
    phase: enumName("CREATED"),
    type: enumName(typeName),
    name,
    children: options.children,
    ...(options.parent ? { parentIndex: makeParentIndex(options.parent) } : {}),
    ...(symbolData ? { symbolData } : {}),
  };
}

function collectAll(node: FigNode, out: FigNode[]): void {
  out.push(node);
  for (const child of node.children ?? []) {
    if (child) { collectAll(child, out); }
  }
}

function sourceFrom(root: FigNode): FigDocumentContext {
  const nodeChanges: FigNode[] = [];
  collectAll(root, nodeChanges);
  return createFigDocumentContextFromNodeChanges({
    nodeChanges,
    blobs: [],
    images: new Map(),
    metadata: null,
  });
}

describe("SECTION-grouped symbol resolution", () => {
  it("registers SYMBOLs declared inside a SECTION as component targets", () => {
    // Scene:
    //   CANVAS
    //   ├── SECTION "App Store symbols"
    //   │     └── SYMBOL "Search toolbar"
    //   └── FRAME "iPhone Page"
    //         └── INSTANCE → "Search toolbar"
    //
    // The INSTANCE's effective SYMBOL is the SECTION-grouped node.
    // buildRegistry must surface it as a component target even
    // though the SECTION itself is not a registry target.
    const symbolGuid = makeGuid(2304, 20222);
    const sectionGuid = makeGuid(1, 100);
    const canvasGuid = makeGuid(1, 1);
    const frameGuid = makeGuid(1, 200);
    const instanceGuid = makeGuid(1, 201);

    const symbol = makeNode("SYMBOL", "Search toolbar", symbolGuid, { parent: sectionGuid });
    const section = makeNode("SECTION", "App Store symbols", sectionGuid, {
      parent: canvasGuid,
      children: [symbol],
    });
    const instance = makeNode("INSTANCE", "Search toolbar", instanceGuid, {
      parent: frameGuid,
      symbolID: symbolGuid,
    });
    const frame = makeNode("FRAME", "iPhone Page", frameGuid, {
      parent: canvasGuid,
      children: [instance],
    });
    const canvas = makeNode("CANVAS", "iPhone", canvasGuid, { children: [section, frame] });

    const source = sourceFrom(canvas);

    // listFrameTargets descends through the SECTION; the FRAME is at
    // canvas level so it appears before any SECTION descents.
    const frames = listFrameTargets(source.document, canvas);
    expect(frames.map((f) => f.name)).toEqual(["Search toolbar", "iPhone Page"]);

    const registry = buildRegistry(source, [frame]);
    expect(registry.frames.size).toBe(1);
    // The INSTANCE inside `frame` points at the SECTION-grouped
    // SYMBOL — buildRegistry must follow that pointer through and
    // register the SYMBOL as a component target.
    expect(registry.components.size).toBe(1);
    const target = registry.components.get(guidToString(symbolGuid));
    if (!target) {
      throw new Error("expected the SECTION-grouped SYMBOL in the component registry");
    }
    expect(target.node).toBe(symbol);
  });

  it("resolves a SYMBOL one level deeper (SECTION → SECTION → SYMBOL)", () => {
    const symbolGuid = makeGuid(1, 50);
    const innerSectionGuid = makeGuid(1, 40);
    const outerSectionGuid = makeGuid(1, 30);
    const canvasGuid = makeGuid(1, 1);
    const frameGuid = makeGuid(1, 200);
    const instanceGuid = makeGuid(1, 201);

    const symbol = makeNode("SYMBOL", "Pin", symbolGuid, { parent: innerSectionGuid });
    const innerSection = makeNode("SECTION", "Common", innerSectionGuid, {
      parent: outerSectionGuid,
      children: [symbol],
    });
    const outerSection = makeNode("SECTION", "Library", outerSectionGuid, {
      parent: canvasGuid,
      children: [innerSection],
    });
    const instance = makeNode("INSTANCE", "Pin", instanceGuid, {
      parent: frameGuid,
      symbolID: symbolGuid,
    });
    const frame = makeNode("FRAME", "Use Pin", frameGuid, {
      parent: canvasGuid,
      children: [instance],
    });
    const canvas = makeNode("CANVAS", "Test", canvasGuid, {
      children: [outerSection, frame],
    });

    const source = sourceFrom(canvas);

    const registry = buildRegistry(source, [frame]);
    expect(registry.components.size).toBe(1);
    const target = registry.components.get(guidToString(symbolGuid));
    if (!target) {
      throw new Error("nested-SECTION SYMBOL missed by the registry");
    }
    expect(target.componentName).toBe("Pin");
  });

});
