/**
 * @file Spec for autolayout planning. Locks in the Figma-to-SwiftUI mapping.
 */
import type { FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import {
  counterAlignmentForHStack,
  counterAlignmentForVStack,
  pickStackKind,
  planLayout,
  primaryDistribution,
  resolvePadding,
} from "./autolayout";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function makeFrame(partial: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("FRAME"),
    ...partial,
  } as FigNode;
}

describe("pickStackKind", () => {
  it("returns HStack for HORIZONTAL stackMode", () => {
    expect(pickStackKind(makeFrame({ stackMode: enumName("HORIZONTAL") }))).toBe("HStack");
  });
  it("returns VStack for VERTICAL stackMode", () => {
    expect(pickStackKind(makeFrame({ stackMode: enumName("VERTICAL") }))).toBe("VStack");
  });
  it("returns ZStack when stackMode is missing", () => {
    expect(pickStackKind(makeFrame({}))).toBe("ZStack");
  });
});

describe("resolvePadding", () => {
  it("returns zero padding when no fields set", () => {
    expect(resolvePadding(makeFrame({}))).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
  it("uses uniform stackPadding for all sides", () => {
    expect(resolvePadding(makeFrame({ stackPadding: 12 }))).toEqual({
      top: 12,
      right: 12,
      bottom: 12,
      left: 12,
    });
  });
  it("applies horizontal/vertical overrides", () => {
    expect(
      resolvePadding(
        makeFrame({ stackHorizontalPadding: 8, stackVerticalPadding: 16 }),
      ),
    ).toEqual({ top: 16, right: 8, bottom: 16, left: 8 });
  });
  it("applies right/bottom overrides on top of horizontal/vertical", () => {
    expect(
      resolvePadding(
        makeFrame({
          stackHorizontalPadding: 8,
          stackVerticalPadding: 16,
          stackPaddingRight: 4,
          stackPaddingBottom: 24,
        }),
      ),
    ).toEqual({ top: 16, right: 4, bottom: 24, left: 8 });
  });
});

describe("counterAlignmentForHStack", () => {
  it("maps MIN/CENTER/MAX", () => {
    expect(counterAlignmentForHStack(makeFrame({ stackCounterAlignItems: enumName("MIN") }))).toBe("top");
    expect(counterAlignmentForHStack(makeFrame({ stackCounterAlignItems: enumName("CENTER") }))).toBe("center");
    expect(counterAlignmentForHStack(makeFrame({ stackCounterAlignItems: enumName("MAX") }))).toBe("bottom");
  });
  it("defaults to top (Figma MIN default) when not set", () => {
    expect(counterAlignmentForHStack(makeFrame({}))).toBe("top");
  });
});

describe("counterAlignmentForVStack", () => {
  it("maps MIN/CENTER/MAX to leading/center/trailing", () => {
    expect(counterAlignmentForVStack(makeFrame({ stackCounterAlignItems: enumName("MIN") }))).toBe("leading");
    expect(counterAlignmentForVStack(makeFrame({ stackCounterAlignItems: enumName("CENTER") }))).toBe("center");
    expect(counterAlignmentForVStack(makeFrame({ stackCounterAlignItems: enumName("MAX") }))).toBe("trailing");
  });
  it("defaults to leading (Figma MIN default) when not set", () => {
    expect(counterAlignmentForVStack(makeFrame({}))).toBe("leading");
  });
});

describe("primaryDistribution", () => {
  it("maps the four Figma values", () => {
    expect(primaryDistribution(makeFrame({ stackPrimaryAlignItems: enumName("MIN") }))).toBe("min");
    expect(primaryDistribution(makeFrame({ stackPrimaryAlignItems: enumName("CENTER") }))).toBe("center");
    expect(primaryDistribution(makeFrame({ stackPrimaryAlignItems: enumName("MAX") }))).toBe("max");
    expect(primaryDistribution(makeFrame({ stackPrimaryAlignItems: enumName("SPACE_BETWEEN") }))).toBe(
      "space-between",
    );
  });
});

describe("planLayout", () => {
  it("plans an HStack with spacing + cross-axis alignment", () => {
    const node = makeFrame({
      stackMode: enumName("HORIZONTAL"),
      stackSpacing: 8,
      stackCounterAlignItems: enumName("CENTER"),
    });
    expect(planLayout(node)).toEqual({
      stack: "HStack",
      alignment: "center",
      spacing: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      primary: "min",
    });
  });

  it("plans a ZStack with topLeading alignment for non-autolayout frames", () => {
    expect(planLayout(makeFrame({}))).toEqual({
      stack: "ZStack",
      alignment: "topLeading",
      spacing: undefined,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      primary: "min",
    });
  });
});
