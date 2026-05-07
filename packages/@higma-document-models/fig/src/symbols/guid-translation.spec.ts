/** @file GUID translation unit tests. */

import type { FigGuid, FigKiwiSymbolOverride, FigNode, FigNodeType, FigPaint, KiwiEnumValue } from "../types";
import { buildGuidTranslationMap } from "./guid-translation";

function guid(sessionID: number, localID: number): FigGuid {
  return { sessionID, localID };
}

function nodeType(name: FigNodeType): KiwiEnumValue<FigNodeType> {
  return { value: -1, name };
}

function createNode(fields: Partial<FigNode>): FigNode {
  return {
    guid: guid(1, 1),
    phase: { value: 1, name: "CREATED" },
    type: nodeType("FRAME"),
    ...fields,
  };
}

function textOverride(target: FigGuid, characters: string): FigKiwiSymbolOverride {
  return {
    guidPath: { guids: [target] },
    derivedTextData: {
      derivedLines: [{ characters }],
    },
  };
}

const IMAGE_PAINT: FigPaint = {
  type: "IMAGE",
  imageRef: "image-ref",
  visible: true,
  opacity: 1,
};

function imageShapeOverride(target: FigGuid): FigKiwiSymbolOverride {
  return {
    guidPath: { guids: [target] },
    fillPaints: [IMAGE_PAINT],
  };
}

describe("buildGuidTranslationMap", () => {
  it("evicts SHAPE overrides that majority-offset matching placed on TEXT nodes", () => {
    const symbolRoot = createNode({
      type: nodeType("SYMBOL"),
      guid: guid(1, 100),
      children: [
        createNode({ type: nodeType("TEXT"), guid: guid(1, 101), characters: "Name" }),
        createNode({ type: nodeType("TEXT"), guid: guid(1, 102), characters: "Count" }),
        createNode({ type: nodeType("RECTANGLE"), guid: guid(1, 103) }),
        createNode({ type: nodeType("RECTANGLE"), guid: guid(1, 104) }),
      ],
    });

    const map = buildGuidTranslationMap(
      symbolRoot,
      [
        textOverride(guid(2, 201), "Name"),
        imageShapeOverride(guid(2, 202)),
        textOverride(guid(2, 203), "Count"),
        imageShapeOverride(guid(2, 204)),
      ],
      undefined,
    );

    expect(map.get("2:202")).not.toBe("1:102");
  });
});
