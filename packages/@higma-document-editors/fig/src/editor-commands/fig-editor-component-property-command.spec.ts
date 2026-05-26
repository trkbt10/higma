/** @file Fig editor INSTANCE component property operation tests. */
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig";
import type { FigComponentPropValue } from "@higma-document-models/fig/types";
import {
  sectionDocument,
  sectionGuid,
  sectionNode,
  sectionPage,
} from "../panels/sections/section-specimen";
import {
  readFigEditorResolvedComponentProperties,
  writeFigEditorComponentPropertyAssignment,
} from "./fig-editor-component-property-command";

const DEF_GUID = sectionGuid(100);
const OTHER_DEF_GUID = sectionGuid(101);

function readContext(nodes: readonly ReturnType<typeof sectionNode>[]) {
  return {
    context: createFigDocumentContextFromNodeChanges({
      nodeChanges: [sectionDocument(), sectionPage(), ...nodes],
      blobs: [],
      images: new Map(),
      metadata: null,
    }),
  };
}

describe("readFigEditorResolvedComponentProperties", () => {
  it("reads inherited Kiwi parentPropDefId fields through the SymbolResolver target document", () => {
    const frame = sectionNode("FRAME", {
      guid: sectionGuid(9),
      componentPropDefs: [{
        id: DEF_GUID,
        name: "Time",
        type: { value: 1, name: "TEXT" },
        initialValue: { textValue: { characters: "9:41" } },
      }],
    });
    const symbol = sectionNode("SYMBOL", {
      guid: sectionGuid(10),
      parentIndex: { guid: frame.guid, position: "!" },
      componentPropDefs: [{
        id: sectionGuid(102),
        parentPropDefId: DEF_GUID,
      }],
    });
    const instance = sectionNode("INSTANCE", {
      guid: sectionGuid(11),
      symbolData: { symbolID: symbol.guid },
    });

    const resolved = readFigEditorResolvedComponentProperties(
      readContext([frame, symbol, instance]),
      instance,
    );

    expect(resolved?.symbol.node).toBe(symbol);
    expect(resolved?.properties).toEqual([{
      def: symbol.componentPropDefs?.[0],
      resolvedDef: {
        id: sectionGuid(102),
        name: "Time",
        type: "TEXT",
        initialValue: { textValue: { characters: "9:41" } },
        sourceDef: symbol.componentPropDefs?.[0],
      },
      value: { textValue: { characters: "9:41" } },
      isOverridden: false,
    }]);
  });

  it("returns explicit unresolved state when the INSTANCE target is unavailable", () => {
    const instance = sectionNode("INSTANCE", {
      guid: sectionGuid(11),
      symbolData: { symbolID: sectionGuid(999) },
    });

    expect(readFigEditorResolvedComponentProperties(readContext([instance]), instance)).toBeUndefined();
  });
});

describe("writeFigEditorComponentPropertyAssignment", () => {
  it("adds a missing component property assignment", () => {
    const instance = sectionNode("INSTANCE");
    const value: FigComponentPropValue = { textValue: { characters: "Buy" } };

    const updated = writeFigEditorComponentPropertyAssignment(instance, DEF_GUID, value);

    expect(updated.componentPropAssignments).toEqual([{ defID: DEF_GUID, value }]);
  });

  it("replaces only the matching assignment", () => {
    const previous: FigComponentPropValue = { textValue: { characters: "Before" } };
    const retained: FigComponentPropValue = { boolValue: true };
    const next: FigComponentPropValue = { textValue: { characters: "After" } };
    const instance = sectionNode("INSTANCE", {
      componentPropAssignments: [
        { defID: OTHER_DEF_GUID, value: retained },
        { defID: DEF_GUID, value: previous },
      ],
    });

    const updated = writeFigEditorComponentPropertyAssignment(instance, DEF_GUID, next);

    expect(updated.componentPropAssignments).toEqual([
      { defID: OTHER_DEF_GUID, value: retained },
      { defID: DEF_GUID, value: next },
    ]);
  });

  it("throws when the target is not an INSTANCE", () => {
    const rectangle = sectionNode("RECTANGLE");

    expect(() => writeFigEditorComponentPropertyAssignment(rectangle, DEF_GUID, { boolValue: true })).toThrow(
      "writeFigEditorComponentPropertyAssignment requires an INSTANCE node",
    );
  });
});
