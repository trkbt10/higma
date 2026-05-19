/** @file Fig paint color tests. */

import { asImagePaint, asSolidPaint, getPaintType } from "./color";
import type { FigImagePaint } from "./types";

function isObject(value: unknown): value is { readonly type: unknown; readonly image?: unknown } {
  return typeof value === "object" && value !== null && "type" in value;
}

function isKiwiImagePaint(value: unknown): value is FigImagePaint {
  if (!isObject(value)) {
    return false;
  }
  return getPaintType(value) === "IMAGE";
}

describe("paint type accessors", () => {
  it("rejects string paint type tags", () => {
    expect(() => getPaintType({ type: "SOLID" })).toThrow("FigPaint.type must be a supported paint type");
  });

  it("reads Kiwi enum paint types from decoded canvas nodes", () => {
    const paint = {
      type: { value: 5, name: "IMAGE" },
      image: { hash: [0xab, 0xcd] },
    };
    if (!isKiwiImagePaint(paint)) {
      throw new Error("test fixture must be a Kiwi IMAGE paint");
    }

    expect(getPaintType(paint)).toBe("IMAGE");
    expect(asImagePaint(paint)?.image?.hash).toEqual([0xab, 0xcd]);
    expect(asSolidPaint(paint)).toBeUndefined();
  });

  it("throws on unsupported Kiwi paint type values", () => {
    const paint = { type: { value: 999, name: "UNKNOWN" } };

    expect(() => getPaintType(paint)).toThrow("FigPaint.type must be a supported paint type");
  });
});
