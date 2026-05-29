/**
 * @file Fixture-driven specs for the liquid (px → vw/calc) translation.
 *
 * Each case states a fixed-px style record and the exact fluid record
 * `liquefyStyle` must produce against a design width. The transform is
 * pure, so these pin its behaviour without the emitter or a browser.
 *
 * The model: a design width `W`; a scale unit `--lqd: min(1vw, W/100px)`
 * seeded on roots; every length `L px` rewritten to
 * `calc(L/W*100 * var(--lqd))`. At the design width every length resolves
 * back to its authored px (the identity invariant); below it the whole
 * record scales uniformly, preserving aspect ratio.
 */
import { liquefyStyle, instanceScaleVar } from "./liquid";

const W = 1440;

describe("liquefyStyle — length rewriting", () => {
  it("rewrites a px length to calc against the shared unit", () => {
    expect(liquefyStyle({ width: "200px" }, W, "descendant")).toEqual({
      width: "calc(13.8889 * var(--lqd))", // 200 / 1440 * 100
    });
  });

  it("rewrites every px in a shorthand", () => {
    expect(liquefyStyle({ padding: "8px 16px" }, W, "descendant")).toEqual({
      padding: "calc(0.5556 * var(--lqd)) calc(1.1111 * var(--lqd))",
    });
  });

  it("rewrites the px offsets in a multi-value prop, leaving the rest", () => {
    expect(liquefyStyle({ boxShadow: "0px 2px 4px rgba(0, 0, 0, 0.1)" }, W, "descendant")).toEqual({
      boxShadow: "0px calc(0.1389 * var(--lqd)) calc(0.2778 * var(--lqd)) rgba(0, 0, 0, 0.1)",
    });
  });

  it("scales a negative length (preserving sign through the factor)", () => {
    expect(liquefyStyle({ top: "-102px" }, W, "descendant")).toEqual({
      top: "calc(-7.0833 * var(--lqd))", // -102 / 1440 * 100
    });
  });

  it("leaves non-px values untouched (%, auto, tokens, colours)", () => {
    const input = { width: "100%", height: "auto", background: "var(--color-c3)", color: "#fff" };
    expect(liquefyStyle(input, W, "descendant")).toEqual(input);
  });

  it("keeps a zero length as 0px", () => {
    expect(liquefyStyle({ margin: "0px" }, W, "descendant")).toEqual({ margin: "0px" });
  });

  it("adds no scale unit to a descendant", () => {
    expect(liquefyStyle({ width: "200px" }, W, "descendant")["--lqd"]).toBeUndefined();
  });
});

describe("liquefyStyle — page root", () => {
  it("seeds the scale unit, centres the capped column, grows instead of clipping", () => {
    const out = liquefyStyle(
      { width: "1440px", height: "6154px", overflow: "hidden", display: "flex", background: "var(--color-c3)" },
      W,
      "page-root",
    );
    expect(out["--lqd"]).toBe("min(1vw, 14.4px)"); // W / 100
    expect(out.width).toBe("calc(100 * var(--lqd))"); // min(100vw, 1440px)
    expect(out.marginLeft).toBe("auto");
    expect(out.marginRight).toBe("auto");
    expect(out.background).toBe("var(--color-c3)");
    // A fluid page never clips itself; the authored height becomes a floor.
    expect(out.overflow).toBeUndefined();
    expect(out.height).toBeUndefined();
    expect(out.minHeight).toBe("calc(427.3611 * var(--lqd))"); // 6154 / 1440 * 100
  });
});

describe("liquefyStyle — component root", () => {
  it("adopts the wrapper's handed-down unit (falling back to its own width), and does not centre or grow", () => {
    const out = liquefyStyle({ width: "100%", height: "100%" }, 720, "component-root");
    // The component scales with the page that placed it (`--lqd-down`),
    // falling back to its own width only when viewed standalone.
    expect(out["--lqd"]).toBe("var(--lqd-down, min(1vw, 7.2px))"); // 720 / 100
    expect(out.marginLeft).toBeUndefined();
    expect(out.minHeight).toBeUndefined();
    expect(out.width).toBe("100%");
  });
});

describe("instanceScaleVar — components scale with the page, not their own width", () => {
  it("derives --lqd-down from the parent's --lqd and the component footprint", () => {
    // A 420-wide card in a 1440 page: its unit is 0.2917 of the page's,
    // so the card shrinks with the page instead of freezing at 420px.
    expect(instanceScaleVar(420, 1440)).toEqual({ key: "--lqd-down", value: "calc(var(--lqd) * 0.2917)" });
  });
});

describe("liquefyStyle — design-width identity", () => {
  it("every factor × the frozen unit resolves back to the authored px", () => {
    // At/above the design width `--lqd` freezes at W/100 px, so
    // `factor × (W/100)` === the authored px for each length.
    const lengths = [200, 48, 1440, 12.5];
    const unit = W / 100;
    for (const px of lengths) {
      const out = liquefyStyle({ width: `${px}px` }, W, "descendant");
      const factor = Number.parseFloat(out.width.replace("calc(", ""));
      expect(Math.round(factor * unit * 100) / 100).toBe(px);
    }
  });
});
