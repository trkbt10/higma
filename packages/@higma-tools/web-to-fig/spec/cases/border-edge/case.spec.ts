/**
 * @file Case `border-edge` — single-edge borders synthesise an
 * absolute-positioned thin FRAME for the bordered side instead of a
 * full-perimeter stroke.
 *
 * History: prior to the per-edge synth, a `border-bottom: 2px solid
 * pink` collapsed to a single Figma stroke painted around the *whole*
 * node, turning a decorative bottom rule into an outlined card.
 * Painting the partial border as a child FRAME matches CSS exactly —
 * only the authored edge renders, and the IR's single-stroke surface
 * stays clean for the symmetric case.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { DEFAULT_EDGE_COLOR, DEFAULT_EDGE_WIDTH_PX, withSingleEdgeBorder } from "./fixture";

describe("case border-edge", () => {
  const frame = asFrame(singleChild(normalizeOne(withSingleEdgeBorder(baseDiv()))));

  it("does NOT emit a perimeter stroke for an asymmetric (single-edge) border", () => {
    expect(frame.style.strokes).toHaveLength(0);
  });

  it("synthesises one edge-line FRAME child for the authored side", () => {
    const edgeChildren = frame.children.filter((c) => c.name.startsWith("border-"));
    expect(edgeChildren).toHaveLength(1);
  });

  it("the synthesised edge FRAME carries the captured edge colour as its fill", () => {
    const edge = frame.children.find((c) => c.name.startsWith("border-"));
    if (!edge || edge.kind !== "frame") {
      throw new Error("expected an edge FRAME child");
    }
    const fill = edge.style.fills.find((f) => f.kind === "solid");
    if (!fill || fill.kind !== "solid") {
      throw new Error("expected SOLID fill on the edge FRAME");
    }
    // DEFAULT_EDGE_COLOR is rgb(255, 0, 128).
    expect(fill.color.r).toBeCloseTo(1, 3);
    expect(fill.color.g).toBeCloseTo(0, 3);
    expect(fill.color.b).toBeCloseTo(128 / 255, 3);
    void DEFAULT_EDGE_COLOR;
  });

  it("the synthesised edge FRAME's height equals the captured edge width", () => {
    const edge = frame.children.find((c) => c.name === "border-bottom");
    if (!edge || edge.kind !== "frame") {
      throw new Error("expected a border-bottom edge FRAME");
    }
    expect(edge.box.height).toBe(DEFAULT_EDGE_WIDTH_PX);
  });

  it("works on every side — top / right / bottom / left", () => {
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const f = asFrame(
        singleChild(normalizeOne(withSingleEdgeBorder(baseDiv(), side, 1, "rgb(0, 200, 0)"))),
      );
      const edge = f.children.find((c) => c.name === `border-${side}`);
      if (!edge || edge.kind !== "frame") {
        throw new Error(`expected a border-${side} edge FRAME`);
      }
      const fill = edge.style.fills.find((p) => p.kind === "solid");
      if (!fill || fill.kind !== "solid") {
        throw new Error("expected SOLID fill on edge FRAME");
      }
      expect(fill.color.g).toBeCloseTo(200 / 255, 3);
    }
  });
});
