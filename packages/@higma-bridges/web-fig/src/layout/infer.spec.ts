/**
 * @file Unit tests for the auto-layout inference.
 */
import { inferAutoLayout } from "./infer";

describe("inferAutoLayout", () => {
  it("detects a uniform row of three cards with even gaps", () => {
    const result = inferAutoLayout({
      parent: { x: 0, y: 0, width: 348, height: 80 },
      children: [
        { x: 12, y: 12, width: 100, height: 56 },
        { x: 124, y: 12, width: 100, height: 56 },
        { x: 236, y: 12, width: 100, height: 56 },
      ],
    });
    expect(result.direction).toBe("row");
    if (result.direction === "row") {
      expect(result.gap).toBe(12);
      expect(result.paddingTop).toBe(12);
      expect(result.paddingBottom).toBe(12);
      expect(result.paddingLeft).toBe(12);
      expect(result.paddingRight).toBe(12);
      expect(result.counterAlign).toBe("start");
    }
  });

  it("detects a column with shared right edge as end-aligned", () => {
    const result = inferAutoLayout({
      parent: { x: 0, y: 0, width: 200, height: 200 },
      children: [
        { x: 100, y: 10, width: 90, height: 30 },
        { x: 80, y: 50, width: 110, height: 30 },
        { x: 110, y: 90, width: 80, height: 30 },
      ],
    });
    expect(result.direction).toBe("column");
    if (result.direction === "column") {
      expect(result.counterAlign).toBe("end");
    }
  });

  it("returns none when gaps are irregular", () => {
    const result = inferAutoLayout({
      parent: { x: 0, y: 0, width: 360, height: 80 },
      children: [
        { x: 12, y: 12, width: 100, height: 56 },
        { x: 124, y: 12, width: 100, height: 56 },
        { x: 250, y: 12, width: 100, height: 56 },
      ],
    });
    expect(result.direction).toBe("none");
  });

  it("returns none when children overlap", () => {
    const result = inferAutoLayout({
      parent: { x: 0, y: 0, width: 360, height: 80 },
      children: [
        { x: 12, y: 12, width: 100, height: 56 },
        { x: 80, y: 12, width: 100, height: 56 },
      ],
    });
    expect(result.direction).toBe("none");
  });

  it("converts symmetric vertical inset to primary-axis center on a column", () => {
    // Single-child paragraph hosts always emit a column stack.
    // Symmetric vertical inset (top=bottom=20) drives primaryAlign=center
    // on the column. Asymmetric horizontal inset (left=10 vs right=20)
    // stays as fixed padding because there is no centring intent.
    const result = inferAutoLayout({
      parent: { x: 0, y: 0, width: 100, height: 100 },
      children: [{ x: 10, y: 20, width: 70, height: 60 }],
    });
    expect(result.direction).toBe("column");
    if (result.direction === "column") {
      expect(result.paddingTop).toBe(0);
      expect(result.paddingBottom).toBe(0);
      expect(result.primaryAlign).toBe("center");
      expect(result.paddingLeft).toBe(10);
      expect(result.paddingRight).toBe(20);
      expect(result.counterAlign).toBe("start");
    }
  });

  it("converts horizontally symmetric inset to counter-axis center", () => {
    // example.com's body-margin-auto pattern: symmetric horizontal
    // inset (left=right=256) drives counterAlign=center on the column
    // container. Asymmetric vertical inset stays as padding so the
    // page anchors at the top of the viewport.
    const result = inferAutoLayout({
      parent: { x: 0, y: 0, width: 1280, height: 800 },
      children: [{ x: 256, y: 120, width: 768, height: 96 }],
    });
    expect(result.direction).toBe("column");
    if (result.direction === "column") {
      expect(result.counterAlign).toBe("center");
      expect(result.paddingLeft).toBe(0);
      expect(result.paddingRight).toBe(0);
      expect(result.paddingTop).toBe(120);
      expect(result.paddingBottom).toBeCloseTo(584, 0);
    }
  });
});
