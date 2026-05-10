/**
 * @file Unit tests for FrameNodeBuilder
 */

import { frameNode } from "./frame";
import { dropShadow, effects } from "../effect";
import { solidPaint } from "../paint";

describe("FrameNodeBuilder", () => {
  it("creates basic frame with defaults", () => {
    const node = frameNode(1, 0).build();

    expect(node.localID).toBe(1);
    expect(node.parentID).toBe(0);
    expect(node.name).toBe("Frame");
    expect(node.size).toEqual({ x: 200, y: 100 });
    expect(node.clipsContent).toBe(true);
    expect(node.visible).toBe(true);
    expect(node.opacity).toBe(1);
  });

  it("sets basic frame properties", () => {
    const node = frameNode(1, 0)
      .name("Container")
      .size(300, 200)
      .position(50, 50)
      .background({ r: 0.9, g: 0.9, b: 0.9, a: 1 })
      .clipsContent(false)
      .cornerRadius(8)
      .build();

    expect(node.name).toBe("Container");
    expect(node.size).toEqual({ x: 300, y: 200 });
    expect(node.transform.m02).toBe(50);
    expect(node.transform.m12).toBe(50);
    expect(node.fillPaints[0].color).toEqual({ r: 0.9, g: 0.9, b: 0.9, a: 1 });
    expect(node.clipsContent).toBe(false);
    expect(node.cornerRadius).toBe(8);
  });

  it("sets frame-level opacity, effects, stroke, and explicit fill paint", () => {
    const shadow = effects(dropShadow().offset(0, 4).blur(12));
    const fill = solidPaint({ r: 0.2, g: 0.4, b: 0.8, a: 1 }).opacity(0.7).build();

    const node = frameNode(1, 0)
      .fill(fill)
      .opacity(0.5)
      .effects(shadow)
      .stroke({ r: 1, g: 0, b: 0, a: 1 })
      .strokeWeight(4)
      .build();

    expect(node.fillPaints).toEqual([fill]);
    expect(node.opacity).toBe(0.5);
    expect(node.effects).toEqual(shadow);
    expect(node.strokePaints?.[0].color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(node.strokeWeight).toBe(4);
  });

  describe("AutoLayout - Frame Level", () => {
    it("sets stroke layout fields", () => {
      const node = frameNode(1, 0)
        .bordersTakeSpace(true)
        .borderWeights({ top: 1, right: 2, bottom: 3, left: 4 })
        .build();

      expect(node.bordersTakeSpace).toBe(true);
      expect(node.borderTopWeight).toBe(1);
      expect(node.borderRightWeight).toBe(2);
      expect(node.borderBottomWeight).toBe(3);
      expect(node.borderLeftWeight).toBe(4);
      expect(node.borderStrokeWeightsIndependent).toBe(true);
    });

    it("sets aspect ratio lock fields", () => {
      const node = frameNode(1, 0)
        .lockAspectRatio(16, 9)
        .build();

      expect(node.targetAspectRatio).toEqual({ x: 16, y: 9 });
      expect(node.proportionsConstrained).toBe(true);
    });

    it("sets min and max size fields", () => {
      const node = frameNode(1, 0)
        .minSize({ x: 120, y: 80 })
        .maxSize({ x: 360, y: 240 })
        .build();

      expect(node.minSize).toEqual({ x: 120, y: 80 });
      expect(node.maxSize).toEqual({ x: 360, y: 240 });
    });

    it("creates horizontal auto-layout frame", () => {
      const node = frameNode(1, 0)
        .autoLayout("HORIZONTAL")
        .gap(10)
        .primaryAlign("MIN")
        .counterAlign("CENTER")
        .build();

      expect(node.stackMode).toEqual({ value: 1, name: "HORIZONTAL" });
      expect(node.stackSpacing).toBe(10);
      expect(node.stackPrimaryAlignItems).toEqual({ value: 0, name: "MIN" });
      expect(node.stackCounterAlignItems).toEqual({ value: 1, name: "CENTER" });
    });

    it("creates vertical auto-layout frame", () => {
      // `stackCounterAlignItems` is encoded as the Figma `StackAlign`
      // enum, which does not include STRETCH (that lives on
      // `StackCounterAlign` for `stackChildAlignSelf`). The legal
      // parent-level values are MIN / CENTER / MAX / BASELINE — pick
      // CENTER here as a representative non-default alignment.
      const node = frameNode(1, 0)
        .autoLayout("VERTICAL")
        .gap(16)
        .primaryAlign("CENTER")
        .counterAlign("CENTER")
        .build();

      expect(node.stackMode).toEqual({ value: 2, name: "VERTICAL" });
      expect(node.stackSpacing).toBe(16);
      expect(node.stackPrimaryAlignItems).toEqual({ value: 1, name: "CENTER" });
      expect(node.stackCounterAlignItems).toEqual({ value: 1, name: "CENTER" });
    });

    it("sets uniform padding", () => {
      const node = frameNode(1, 0)
        .autoLayout("HORIZONTAL")
        .padding(16)
        .build();

      expect(node.stackPadding).toEqual({
        top: 16,
        right: 16,
        bottom: 16,
        left: 16,
      });
    });

    it("sets individual padding", () => {
      const node = frameNode(1, 0)
        .autoLayout("VERTICAL")
        .padding({ top: 10, right: 20, bottom: 30, left: 40 })
        .build();

      expect(node.stackPadding).toEqual({
        top: 10,
        right: 20,
        bottom: 30,
        left: 40,
      });
    });

    it("sets two-value padding (vertical, horizontal)", () => {
      const node = frameNode(1, 0)
        .autoLayout("HORIZONTAL")
        .padding({ top: 10, right: 20, bottom: 10, left: 20 })
        .build();

      expect(node.stackPadding).toEqual({
        top: 10,
        right: 20,
        bottom: 10,
        left: 20,
      });
    });

    it("creates wrap layout", () => {
      // `stackPrimaryAlignContent` decodes against Figma's `StackAlign`
      // enum (MIN / CENTER / MAX / BASELINE — no SPACE_BETWEEN). The
      // wrap-mode content alignment is therefore one of those four;
      // pick CENTER as the representative non-default value.
      const node = frameNode(1, 0)
        .autoLayout("HORIZONTAL")
        .wrap(true)
        .gap(8)
        .counterGap(12)
        .contentAlign("CENTER")
        .build();

      expect(node.stackMode).toEqual({ value: 1, name: "HORIZONTAL" });
      expect(node.stackWrap).toBe(true);
      expect(node.stackSpacing).toBe(8);
      expect(node.stackCounterSpacing).toBe(12);
      expect(node.stackPrimaryAlignContent).toEqual({ value: 1, name: "CENTER" });
    });

    it("sets reverse z-index", () => {
      const node = frameNode(1, 0)
        .autoLayout("HORIZONTAL")
        .reverseZIndex(true)
        .build();

      expect(node.stackReverseZIndex).toBe(true);
    });

    it("auto-enables wrap mode when wrap() is called", () => {
      const node = frameNode(1, 0)
        .wrap(true)
        .build();

      expect(node.stackMode).toBeUndefined();
      expect(node.stackWrap).toBe(true);
    });
  });

  describe("AutoLayout - Child Level", () => {
    it("sets child positioning", () => {
      const node = frameNode(1, 0)
        .positioning("ABSOLUTE")
        .build();

      expect(node.stackPositioning).toEqual({ value: 1, name: "ABSOLUTE" });
    });

    it("sets child sizing", () => {
      const node = frameNode(1, 0)
        .primaryGrow(1)
        .counterSizing("HUG")
        .build();

      expect(node.stackChildPrimaryGrow).toBe(1);
      expect(node.stackPrimarySizing).toBeUndefined();
      expect(node.stackCounterSizing).toEqual({ value: 1, name: "RESIZE_TO_FIT" });
    });

    it("sets constraints", () => {
      const node = frameNode(1, 0)
        .horizontalConstraint("CENTER")
        .verticalConstraint("SCALE")
        .build();

      expect(node.horizontalConstraint).toEqual({ value: 1, name: "CENTER" });
      expect(node.verticalConstraint).toEqual({ value: 4, name: "SCALE" });
    });
  });

  describe("Export Settings", () => {
    it("adds SVG export settings", () => {
      const node = frameNode(1, 0).exportAsSVG().build();

      expect(node.exportSettings).toHaveLength(1);
      expect(node.exportSettings![0].imageType.name).toBe("SVG");
    });

    it("adds PNG export settings", () => {
      const node = frameNode(1, 0).exportAsPNG(2).build();

      expect(node.exportSettings).toHaveLength(1);
      expect(node.exportSettings![0].imageType.name).toBe("PNG");
      expect(node.exportSettings![0].constraint.value).toBe(2);
      expect(node.exportSettings![0].suffix).toBe("@2x");
    });
  });
});

describe("Factory function", () => {
  it("frameNode returns builder with expected methods", () => {
    const builder = frameNode(1, 0);
    expect(typeof builder.name).toBe("function");
    expect(typeof builder.size).toBe("function");
    expect(typeof builder.build).toBe("function");
  });
});
