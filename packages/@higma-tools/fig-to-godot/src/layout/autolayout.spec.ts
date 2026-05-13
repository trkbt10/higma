/**
 * @file Spec for the Figma → Godot autolayout planner.
 *
 * Covers the same matrix as fig-to-swiftui's `autolayout.spec.ts`:
 * stack mode pick, padding resolution, primary/counter alignment
 * mapping. Specifically locks in the divergences from the SwiftUI peer
 * (alignment ends up on the BoxContainer instead of via Spacer
 * insertion; STRETCH lives on per-child size flags rather than a
 * parent enum).
 */
import type { FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import {
  BOX_CONTAINER_ALIGNMENT,
  SIZE_FLAGS,
  boxContainerAlignment,
  counterAlignmentForBoxContainer,
  counterSizeFlagsForChild,
  flowPositionsForGrid,
  flowPositionsForOverlapStack,
  pickContainerKind,
  planLayout,
  primaryDistribution,
  resolvePadding,
} from "./autolayout";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function frame(partial: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("FRAME"),
    ...partial,
  } as FigNode;
}

describe("pickContainerKind", () => {
  it("picks HBoxContainer for HORIZONTAL stack mode", () => {
    expect(pickContainerKind(frame({ stackMode: enumName("HORIZONTAL") }))).toBe("HBoxContainer");
  });
  it("picks VBoxContainer for VERTICAL stack mode", () => {
    expect(pickContainerKind(frame({ stackMode: enumName("VERTICAL") }))).toBe("VBoxContainer");
  });
  it("falls back to Control when stackMode is absent", () => {
    expect(pickContainerKind(frame({}))).toBe("Control");
  });
});

describe("resolvePadding", () => {
  it("returns zeros when no stackPadding* fields are set", () => {
    expect(resolvePadding(frame({}))).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("expands a uniform stackPadding to all four sides", () => {
    expect(resolvePadding(frame({ stackPadding: 12 }))).toEqual({
      top: 12,
      right: 12,
      bottom: 12,
      left: 12,
    });
  });

  it("honors per-axis overrides on top of uniform stackPadding", () => {
    const padding = resolvePadding(
      frame({ stackPadding: 4, stackHorizontalPadding: 16, stackPaddingBottom: 24 }),
    );
    expect(padding).toEqual({ top: 4, right: 16, bottom: 24, left: 16 });
  });
});

describe("primaryDistribution", () => {
  it.each([
    ["MIN", "min"],
    ["CENTER", "center"],
    ["MAX", "max"],
    ["SPACE_BETWEEN", "space-between"],
  ] as const)("maps %s → %s", (input, expected) => {
    expect(primaryDistribution(frame({ stackPrimaryAlignItems: enumName(input) }))).toBe(expected);
  });

  it("defaults to min when stackPrimaryAlignItems is absent", () => {
    expect(primaryDistribution(frame({}))).toBe("min");
  });
});

describe("counterAlignmentForBoxContainer", () => {
  it.each([
    ["MIN", "begin"],
    ["CENTER", "center"],
    ["MAX", "end"],
    ["BASELINE", "begin"],
  ] as const)("maps %s → %s", (input, expected) => {
    expect(counterAlignmentForBoxContainer(frame({ stackCounterAlignItems: enumName(input) }))).toBe(
      expected,
    );
  });

  it("defaults to begin when stackCounterAlignItems is absent", () => {
    expect(counterAlignmentForBoxContainer(frame({}))).toBe("begin");
  });
});

describe("planLayout", () => {
  it("packs HBoxContainer with counter + spacing + padding + primary", () => {
    const plan = planLayout(
      frame({
        stackMode: enumName("HORIZONTAL"),
        stackPrimaryAlignItems: enumName("CENTER"),
        stackCounterAlignItems: enumName("CENTER"),
        stackSpacing: 8,
        stackPadding: 4,
      }),
    );
    expect(plan).toEqual({
      container: "HBoxContainer",
      counter: "center",
      spacing: 8,
      padding: { top: 4, right: 4, bottom: 4, left: 4 },
      primary: "center",
    });
  });

  it("returns Control with min primary for non-autolayout frames", () => {
    const plan = planLayout(frame({}));
    expect(plan.container).toBe("Control");
    expect(plan.primary).toBe("min");
  });
});

describe("NaN-safe spacing reads (fig kiwi sentinel for unset)", () => {
  // The fig binary encoding stores "unset" autolayout slots as NaN
  // rather than omitting the field. Without a finiteness check the
  // typeof === "number" guard treats NaN as a valid spacing and
  // propagates it into Godot offset_* writes, which then trip
  // printFloat's non-finite guard.
  function childOfSize(x: number, y: number): FigNode {
    return frame({ size: { x, y } });
  }

  it("flowPositionsForGrid: NaN stackCounterSpacing inherits stackSpacing", () => {
    // The model types `stackWrap` as `boolean`, but the kiwi parser
    // emits the enum-struct form at runtime — both shapes resolve to
    // the same primary-axis wrap behaviour. Pass `true` here so the
    // partial conforms to the model type while still exercising the
    // wrap branch.
    const parent = frame({
      stackMode: enumName("HORIZONTAL"),
      stackWrap: true,
      stackSpacing: 8,
      stackCounterSpacing: NaN,
      size: { x: 130, y: 160 },
    });
    const children = [
      childOfSize(60, 20),
      childOfSize(60, 20),
      childOfSize(60, 20),
      childOfSize(60, 20),
      childOfSize(60, 20),
    ];
    const positions = flowPositionsForGrid(parent, children);
    expect(positions).toHaveLength(5);
    for (const p of positions) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // 2 children fit in 130px-wide row (60+8+60=128). Row gap inherits
    // the 8px column gap.
    expect(positions[0]).toEqual({ x: 0, y: 0 });
    expect(positions[2]).toEqual({ x: 0, y: 28 });
    expect(positions[4]).toEqual({ x: 0, y: 56 });
  });

  it("flowPositionsForOverlapStack: NaN stackSpacing collapses to 0 gap", () => {
    const parent = frame({
      stackMode: enumName("HORIZONTAL"),
      stackSpacing: NaN,
    });
    const positions = flowPositionsForOverlapStack(parent, [
      childOfSize(10, 10),
      childOfSize(10, 10),
    ]);
    for (const p of positions) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect(positions[1]).toEqual({ x: 10, y: 0 });
  });

  it("resolvePadding: NaN per-side padding collapses to 0, not NaN", () => {
    const node = frame({
      stackHorizontalPadding: NaN,
      stackVerticalPadding: 6,
    });
    const padding = resolvePadding(node);
    expect(Number.isFinite(padding.left)).toBe(true);
    expect(Number.isFinite(padding.top)).toBe(true);
    expect(padding).toEqual({ top: 6, right: 0, bottom: 6, left: 0 });
  });

  it("planLayout: NaN stackSpacing yields undefined plan.spacing", () => {
    const plan = planLayout(
      frame({
        stackMode: enumName("HORIZONTAL"),
        stackSpacing: NaN,
      }),
    );
    expect(plan.spacing).toBeUndefined();
  });
});

describe("boxContainerAlignment", () => {
  it("maps min and space-between to BEGIN, center to CENTER, max to END", () => {
    expect(boxContainerAlignment("min")).toBe(BOX_CONTAINER_ALIGNMENT.BEGIN);
    expect(boxContainerAlignment("space-between")).toBe(BOX_CONTAINER_ALIGNMENT.BEGIN);
    expect(boxContainerAlignment("center")).toBe(BOX_CONTAINER_ALIGNMENT.CENTER);
    expect(boxContainerAlignment("max")).toBe(BOX_CONTAINER_ALIGNMENT.END);
  });
});

describe("counterSizeFlagsForChild", () => {
  function child(partial: Partial<FigNode>): FigNode {
    return frame({ ...partial }) as FigNode;
  }

  it("returns EXPAND_FILL when the child overrides STRETCH", () => {
    expect(counterSizeFlagsForChild("begin", child({ stackChildAlignSelf: enumName("STRETCH") }))).toBe(
      SIZE_FLAGS.EXPAND_FILL,
    );
  });

  it("falls through to the parent default when the child is AUTO", () => {
    expect(counterSizeFlagsForChild("end", child({ stackChildAlignSelf: enumName("AUTO") }))).toBe(
      SIZE_FLAGS.SHRINK_END,
    );
  });

  it("matches each parent default when the child has no override", () => {
    expect(counterSizeFlagsForChild("begin", child({}))).toBe(SIZE_FLAGS.NONE);
    expect(counterSizeFlagsForChild("center", child({}))).toBe(SIZE_FLAGS.SHRINK_CENTER);
    expect(counterSizeFlagsForChild("end", child({}))).toBe(SIZE_FLAGS.SHRINK_END);
    expect(counterSizeFlagsForChild("fill", child({}))).toBe(SIZE_FLAGS.EXPAND_FILL);
  });
});
