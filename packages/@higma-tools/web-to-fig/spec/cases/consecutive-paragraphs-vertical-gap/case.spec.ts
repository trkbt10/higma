/**
 * @file Case `consecutive-paragraphs-vertical-gap` — a heading and two
 * `<p>` siblings separated by their CSS `margin-block` collapse must
 * remain visually separated in the IR. The wrapper FRAME either keeps
 * the children as absolutely-positioned TEXT nodes at the captured
 * y-coordinates, or it lifts the gap onto auto-layout via `gap`.
 * Either representation is correct; what is NOT correct is consecutive
 * TEXT children stacked flush with no gap. The
 * `example-com-fullpage` rendered output drops the gap when the
 * captured y-coordinates already encode it (rendered link sits glued
 * under the body paragraph instead of one font-size below).
 *
 * Today the synthesized version passes: `inferAutoLayout` recognises
 * the three-child uniform column and writes `gap: 16`. The case stays
 * here as a regression detector — if a future change drops the gap
 * inference for short paragraph stacks, this case fails before the
 * fullpage diff regresses.
 */
import type { AutoLayoutIR, FrameNodeIR, NodeIR, TextNodeIR } from "@higma-bridges/web-fig";
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import {
  EXPECTED_VERTICAL_GAP,
  FIRST_RECT_HEIGHT,
  FIRST_RECT_Y,
  FIRST_TEXT,
  SECOND_RECT_Y,
  SECOND_TEXT,
  twoParagraphsWithGap,
} from "./fixture";

describe("case consecutive-paragraphs-vertical-gap", () => {
  const container = asFrame(singleChild(normalizeOne(twoParagraphsWithGap())));

  it("keeps the heading and both paragraphs as separate IR text children", () => {
    const texts = collectTexts(container);
    expect(texts).toHaveLength(3);
  });

  it("preserves the captured y-coordinate of the second paragraph", () => {
    const texts = collectTexts(container);
    const second = texts.find((t) => t.characters === SECOND_TEXT);
    if (second === undefined) {
      throw new Error(`second paragraph missing from IR (got ${texts.map((t) => t.characters).join(" | ")})`);
    }
    const gap = readGap(container.autoLayout);
    if (gap !== undefined) {
      // Auto-layout mode: the vertical gap is encoded as `gap`.
      expect(gap).toBe(EXPECTED_VERTICAL_GAP);
      return;
    }
    // Absolute mode: the second child sits at the captured y-offset
    // relative to its parent. We accept anything within 1px to tolerate
    // sub-pixel rounding, but a `0` y means the gap was dropped.
    expect(second.box.y).toBeCloseTo(SECOND_RECT_Y, 0);
  });

  it("does not glue the second paragraph against the first (gap > 0)", () => {
    const texts = collectTexts(container);
    const first = texts.find((t) => t.characters === FIRST_TEXT);
    const second = texts.find((t) => t.characters === SECOND_TEXT);
    if (first === undefined || second === undefined) {
      throw new Error("expected both paragraphs in IR");
    }
    const gap = readGap(container.autoLayout);
    if (gap !== undefined) {
      expect(gap).toBeGreaterThan(0);
      return;
    }
    const firstBottom = first.box.y + first.box.height;
    expect(second.box.y - firstBottom).toBeGreaterThan(0);
  });

  it("preserves the first paragraph's geometry (sanity)", () => {
    const texts = collectTexts(container);
    const first = texts.find((t) => t.characters === FIRST_TEXT);
    if (first === undefined) {
      throw new Error("first paragraph missing");
    }
    const gap = readGap(container.autoLayout);
    if (gap === undefined) {
      expect(first.box.y).toBeCloseTo(FIRST_RECT_Y, 0);
      expect(first.box.height).toBeCloseTo(FIRST_RECT_HEIGHT, 0);
    }
  });
});

/**
 * Read the primary-axis gap off an AutoLayoutIR; returns `undefined`
 * for the absolute (`direction: "none"`) variant so callers can branch
 * on it. The IR field is `gap` (not Figma's UI label `itemSpacing`).
 */
function readGap(auto: AutoLayoutIR): number | undefined {
  if (auto.direction === "none") {
    return undefined;
  }
  return auto.gap;
}

function collectTexts(node: NodeIR): TextNodeIR[] {
  if (node.kind === "text") {
    return [node];
  }
  if (node.kind !== "frame") {
    return [];
  }
  const frame: FrameNodeIR = node;
  const out: TextNodeIR[] = [];
  for (const child of frame.children) {
    out.push(...collectTexts(child));
  }
  return out;
}
