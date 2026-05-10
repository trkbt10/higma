/**
 * @file Spec — `parseBackgroundImage` honours CSS sizing keywords
 * when mapping a `background-image: url(...)` to an IR `image`
 * paint.
 *
 * Regression guards added when the Wikipedia fidelity test surfaced
 * a hard-coded `scaleMode: "cover"` that painted decorative
 * `background-size: auto` overlays across the full container, and
 * subsequently when multi-layer backgrounds were silently dropping
 * additional `url()` layers.
 */
import { describe, expect, it } from "vitest";
import { parseBackgroundImage } from "./parse-css";

const URL_VALUE = `url("https://example.com/logo.png")`;
const TWO_LAYERS = `url("https://example.com/a.png"), url("https://example.com/b.png")`;
const GRADIENT_AND_URL = `linear-gradient(to right, rgb(0, 0, 0), rgb(255, 255, 255)), url("https://example.com/c.png")`;

describe("parseBackgroundImage scaleMode mapping", () => {
  it("returns cover for `background-size: cover`", () => {
    const paints = parseBackgroundImage(URL_VALUE, ["img-1"], { size: "cover", repeat: "no-repeat" });
    expect(paints).toHaveLength(1);
    const paint = paints[0]!;
    expect(paint.kind).toBe("image");
    if (paint.kind !== "image") {
      throw new Error("expected image paint");
    }
    expect(paint.scaleMode).toBe("cover");
    expect(paint.imageId).toBe("img-1");
  });

  it("returns contain for `background-size: contain`", () => {
    const paints = parseBackgroundImage(URL_VALUE, ["img-1"], { size: "contain", repeat: "no-repeat" });
    const paint = paints[0]!;
    if (paint.kind !== "image") {
      throw new Error("expected image paint");
    }
    expect(paint.scaleMode).toBe("contain");
  });

  it("returns stretch for `background-size: 100% 100%`", () => {
    const paints = parseBackgroundImage(URL_VALUE, ["img-1"], { size: "100% 100%", repeat: "no-repeat" });
    const paint = paints[0]!;
    if (paint.kind !== "image") {
      throw new Error("expected image paint");
    }
    expect(paint.scaleMode).toBe("stretch");
  });

  it("returns tile for the CSS default (`auto` size + `repeat`)", () => {
    const paints = parseBackgroundImage(URL_VALUE, ["img-1"], { size: "auto", repeat: "repeat" });
    const paint = paints[0]!;
    if (paint.kind !== "image") {
      throw new Error("expected image paint");
    }
    expect(paint.scaleMode).toBe("tile");
  });

  it("throws for intrinsic-sized single-instance backgrounds (`auto` + `no-repeat`) — caller must lift these via the synth path", () => {
    expect(() => parseBackgroundImage(URL_VALUE, ["img-1"], { size: "auto", repeat: "no-repeat" })).toThrow(
      /natural-size synth path/,
    );
  });

  it("returns tile when neither `size` nor `repeat` are provided (CSS spec defaults)", () => {
    const paints = parseBackgroundImage(URL_VALUE, ["img-1"]);
    const paint = paints[0]!;
    if (paint.kind !== "image") {
      throw new Error("expected image paint");
    }
    expect(paint.scaleMode).toBe("tile");
  });

  it("emits no paints for `none`", () => {
    expect(parseBackgroundImage("none", [])).toEqual([]);
    expect(parseBackgroundImage("", [])).toEqual([]);
  });
});

describe("parseBackgroundImage multi-layer image-id mapping", () => {
  it("assigns each `url()` layer its own imageId in CSS source order", () => {
    const paints = parseBackgroundImage(TWO_LAYERS, ["img-1", "img-2"]);
    expect(paints).toHaveLength(2);
    if (paints[0]!.kind !== "image" || paints[1]!.kind !== "image") {
      throw new Error("expected image paints");
    }
    expect(paints[0]!.imageId).toBe("img-1");
    expect(paints[1]!.imageId).toBe("img-2");
  });

  it("skips imageIds for gradient layers — the cursor only advances on `url()` tokens", () => {
    const paints = parseBackgroundImage(GRADIENT_AND_URL, ["img-1"]);
    expect(paints).toHaveLength(2);
    expect(paints[0]!.kind).toBe("linear-gradient");
    if (paints[1]!.kind !== "image") {
      throw new Error("expected image paint at index 1");
    }
    expect(paints[1]!.imageId).toBe("img-1");
  });

  it("throws when imageIds runs out before all `url()` layers are mapped — silent drops are forbidden", () => {
    expect(() => parseBackgroundImage(TWO_LAYERS, ["only-one"])).toThrow(
      /no matching imageId/,
    );
  });
});
