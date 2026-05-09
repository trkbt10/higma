/**
 * @file Spec — `parseBackgroundImage` honours CSS sizing keywords
 * when mapping a `background-image: url(...)` to an IR `image`
 * paint.
 *
 * Regression guards added when the Wikipedia fidelity test surfaced
 * a hard-coded `scaleMode: "cover"` that painted decorative
 * `background-size: auto` overlays across the full container.
 */
import { describe, expect, it } from "vitest";
import { parseBackgroundImage } from "./parse-css";

const URL_VALUE = `url("https://example.com/logo.png")`;

describe("parseBackgroundImage scaleMode mapping", () => {
  it("returns cover for `background-size: cover`", () => {
    const paints = parseBackgroundImage(URL_VALUE, "img-1", { size: "cover", repeat: "no-repeat" });
    expect(paints).toHaveLength(1);
    const paint = paints[0]!;
    expect(paint.kind).toBe("image");
    if (paint.kind !== "image") {
      throw new Error("expected image paint");
    }
    expect(paint.scaleMode).toBe("cover");
  });

  it("returns contain for `background-size: contain`", () => {
    const paints = parseBackgroundImage(URL_VALUE, "img-1", { size: "contain", repeat: "no-repeat" });
    const paint = paints[0]!;
    if (paint.kind !== "image") {
      throw new Error("expected image paint");
    }
    expect(paint.scaleMode).toBe("contain");
  });

  it("returns stretch for `background-size: 100% 100%`", () => {
    const paints = parseBackgroundImage(URL_VALUE, "img-1", { size: "100% 100%", repeat: "no-repeat" });
    const paint = paints[0]!;
    if (paint.kind !== "image") {
      throw new Error("expected image paint");
    }
    expect(paint.scaleMode).toBe("stretch");
  });

  it("returns tile for the CSS default (`auto` size + `repeat`)", () => {
    const paints = parseBackgroundImage(URL_VALUE, "img-1", { size: "auto", repeat: "repeat" });
    const paint = paints[0]!;
    if (paint.kind !== "image") {
      throw new Error("expected image paint");
    }
    expect(paint.scaleMode).toBe("tile");
  });

  it("returns contain for intrinsic-sized single-instance backgrounds (`auto` + `no-repeat`)", () => {
    // Pre-fix this returned `cover`, which painted decorative overlays
    // (Wikipedia's puzzle-globe banner) across the full container.
    const paints = parseBackgroundImage(URL_VALUE, "img-1", { size: "auto", repeat: "no-repeat" });
    const paint = paints[0]!;
    if (paint.kind !== "image") {
      throw new Error("expected image paint");
    }
    expect(paint.scaleMode).toBe("contain");
  });

  it("returns tile when neither `size` nor `repeat` are provided (CSS spec defaults)", () => {
    const paints = parseBackgroundImage(URL_VALUE, "img-1");
    const paint = paints[0]!;
    if (paint.kind !== "image") {
      throw new Error("expected image paint");
    }
    expect(paint.scaleMode).toBe("tile");
  });

  it("emits no paints for `none`", () => {
    expect(parseBackgroundImage("none", undefined)).toEqual([]);
    expect(parseBackgroundImage("", undefined)).toEqual([]);
  });
});
