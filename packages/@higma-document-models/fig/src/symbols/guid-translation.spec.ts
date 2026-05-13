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

function sizedShapeOverride(target: FigGuid, size: { x: number; y: number }): FigKiwiSymbolOverride {
  return {
    guidPath: { guids: [target] },
    fillPaints: [IMAGE_PAINT],
    size,
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

  // Regression: when an override entry's first GUID is itself one of the
  // SYMBOL's descendant GUIDs (an identity match), the mapping is exact
  // by construction — Figma's GUID design guarantees uniqueness, so a
  // matching GUID *is* the same logical slot. The size declared on the
  // override is then a legitimate INSTANCE-level resize, not evidence
  // of a Phase 1 majority-vote misroute.
  //
  // This pins the Youtube Mobile App UIKit fixture incident
  // (`docs/investigation-guid-translation-size-mismatch-evict.md`):
  // SYMBOL "Property 1=OFF" with 4 descendants in session 7 received
  // 3 overrides also in session 7, two of which were identity matches
  // (`7:109` and `7:113`) carrying a 542×383 size while the targeted
  // descendants are 40×28. Phase 1's majority-vote produced the
  // (correct) 0-offset mapping, then the size-mismatch validator
  // evicted them and the defensive guard threw. Phase Zero must
  // recognise these as exact and lock them before any heuristic phase.
  it("locks override→descendant identity matches even when the override's size grossly differs", () => {
    const symbolRoot = createNode({
      type: nodeType("SYMBOL"),
      guid: guid(7, 50),
      size: { x: 597, y: 421 },
      children: [
        createNode({ type: nodeType("FRAME"), guid: guid(7, 109), size: { x: 40, y: 28 } }),
        createNode({ type: nodeType("FRAME"), guid: guid(7, 113), size: { x: 40, y: 28 } }),
        createNode({ type: nodeType("TEXT"), guid: guid(7, 120), characters: "label" }),
        createNode({ type: nodeType("RECTANGLE"), guid: guid(7, 121), size: { x: 10, y: 10 } }),
      ],
    });

    const overrides: readonly FigKiwiSymbolOverride[] = [
      // Self-frame override (no matching descendant; emulates the
      // INSTANCE addressing its own root in session 7's namespace).
      sizedShapeOverride(guid(7, 62), { x: 597, y: 421 }),
      // Identity matches: descendant GUIDs reused verbatim by the
      // override entries, with a much larger size (the legitimate
      // INSTANCE-level resize). Both must survive into the result.
      sizedShapeOverride(guid(7, 109), { x: 542, y: 383 }),
      sizedShapeOverride(guid(7, 113), { x: 542, y: 383 }),
    ];

    const map = buildGuidTranslationMap(symbolRoot, overrides, undefined);
    expect(map.get("7:109")).toBe("7:109");
    expect(map.get("7:113")).toBe("7:113");
  });

  // Regression: Phase 1's majority-vote offset can land outlier
  // overrides onto real-but-wrong descendants (sizes mismatch wildly,
  // hint differs, no identity match). The Phase 1 size validator is
  // the SoT for "drop this bad mapping" — the previous defensive
  // mark threw on the operational removal, conflating "phase step
  // ran" with "unhandled inconsistency" and blocking file loads
  // whose only sin was the heuristic mis-routing some sparse-session
  // overrides.
  it("evicts size-mismatched Phase 1 mappings without throwing when session consensus is below threshold", () => {
    const symbolRoot = createNode({
      type: nodeType("SYMBOL"),
      guid: guid(1, 50),
      size: { x: 200, y: 200 },
      children: [
        createNode({ type: nodeType("RECTANGLE"), guid: guid(1, 101), size: { x: 50, y: 30 } }),
        createNode({ type: nodeType("RECTANGLE"), guid: guid(1, 102), size: { x: 50, y: 30 } }),
        createNode({ type: nodeType("RECTANGLE"), guid: guid(1, 999), size: { x: 5, y: 5 } }),
      ],
    });

    // 3 entries in session 2 → triggers Phase 1's majority-vote.
    // Best offset = 100 (201→101, 202→102 both align). 2:888 has no
    // descendant at localID 788, so it never enters `result`, which
    // leaves the session with 2 mappings — below the consensus
    // threshold of 3. The DSD sizes (500×500) are 10× the descendants'
    // (50×30), so the size validator must evict 2:201 and 2:202.
    const overrides: readonly FigKiwiSymbolOverride[] = [
      sizedShapeOverride(guid(2, 201), { x: 500, y: 500 }),
      sizedShapeOverride(guid(2, 202), { x: 500, y: 500 }),
      sizedShapeOverride(guid(2, 888), { x: 500, y: 500 }),
    ];

    // Pre-fix: this call threw DefensiveBranchError. Post-fix: returns
    // a map with the bad mappings dropped.
    const map = buildGuidTranslationMap(symbolRoot, overrides, undefined);
    expect(map.get("2:201")).toBeUndefined();
    expect(map.get("2:202")).toBeUndefined();
  });
});
