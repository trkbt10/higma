/**
 * @file Case `border-uniform` — uniform CSS border becomes a single
 * StrokeIR with the authored width and colour.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import { baseDiv } from "../box-leaf/fixture";
import { DEFAULT_BORDER_COLOR, DEFAULT_BORDER_WIDTH_PX, withUniformBorder } from "./fixture";

describe("case border-uniform", () => {
  const frame = asFrame(singleChild(normalizeOne(withUniformBorder(baseDiv()))));

  it("emits exactly one stroke", () => {
    expect(frame.style.strokes).toHaveLength(1);
  });

  it("stroke weight equals the authored border width", () => {
    expect(frame.style.strokes[0]!.weight).toBe(DEFAULT_BORDER_WIDTH_PX);
  });

  it("stroke paint is SOLID with the authored colour", () => {
    const paint = frame.style.strokes[0]!.paint;
    if (paint.kind !== "solid") {
      throw new Error("expected SOLID stroke paint");
    }
    // DEFAULT_BORDER_COLOR is rgb(40, 40, 40); 40/255 ≈ 0.157.
    expect(paint.color.r).toBeCloseTo(40 / 255, 3);
    expect(paint.color.g).toBeCloseTo(40 / 255, 3);
    expect(paint.color.b).toBeCloseTo(40 / 255, 3);
    void DEFAULT_BORDER_COLOR;
  });

  it("default stroke alignment is `center` (Figma's default)", () => {
    expect(frame.style.strokes[0]!.align).toBe("center");
  });
});
