/** @file Fig paint color helper tests. */

import { asImagePaint, asSolidPaint, getPaintType } from "./color";
import type { FigImagePaint } from "./types";

function isObject(value: unknown): value is { readonly type: unknown; readonly imageRef?: unknown } {
  return typeof value === "object" && value !== null && "type" in value;
}

function isRawImagePaint(value: unknown): value is FigImagePaint {
  if (!isObject(value)) {
    return false;
  }
  return getPaintType(value) === "IMAGE";
}

describe("paint type helpers", () => {
  it("reads parser-normalized string paint types", () => {
    expect(getPaintType({ type: "SOLID" })).toBe("SOLID");
  });

  it("reads raw Kiwi enum paint types when conversion receives decoded canvas nodes", () => {
    const raw = {
      type: { value: 5, name: "IMAGE" },
      imageRef: "image-ref",
    };
    if (!isRawImagePaint(raw)) {
      throw new Error("test fixture must be a raw IMAGE paint");
    }

    expect(getPaintType(raw)).toBe("IMAGE");
    expect(asImagePaint(raw)?.imageRef).toBe("image-ref");
    expect(asSolidPaint(raw)).toBeUndefined();
  });

  it("throws on unsupported raw paint type values", () => {
    const paint = { type: { value: 999, name: "UNKNOWN" } };

    expect(() => getPaintType(paint)).toThrow("FigPaint.type must be a supported paint type");
  });
});
