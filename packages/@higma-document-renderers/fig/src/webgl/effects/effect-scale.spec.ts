/** @file Effect backing-scale SoT tests. */

import type { AffineMatrix } from "@higma-primitives/path";
import { applyEffectOffsetScale, resolveEffectBackingScale } from "./effect-scale";

const IDENTITY: AffineMatrix = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

function uniformScale(s: number, tx = 0, ty = 0): AffineMatrix {
  return { m00: s, m01: 0, m02: tx, m10: 0, m11: s, m12: ty };
}

describe("resolveEffectBackingScale", () => {
  it("equals pixelRatio for identity transform", () => {
    const scale = resolveEffectBackingScale(IDENTITY, 2);
    expect(scale.lengthScale).toBeCloseTo(2);
    expect(scale.m00).toBeCloseTo(2);
    expect(scale.m11).toBeCloseTo(2);
    expect(scale.m01).toBe(0);
    expect(scale.m10).toBe(0);
  });

  it("multiplies viewport scale into both length and offset axes", () => {
    // Viewport zoomed to 200% with retina pixelRatio.
    const scale = resolveEffectBackingScale(uniformScale(2), 2);
    // length scale = sqrt(|det|) * pixelRatio = 2 * 2 = 4
    expect(scale.lengthScale).toBeCloseTo(4);
    expect(scale.m00).toBeCloseTo(4);
    expect(scale.m11).toBeCloseTo(4);
  });

  it("ignores translation", () => {
    const scale = resolveEffectBackingScale(uniformScale(1.5, 100, -50), 1);
    expect(scale.lengthScale).toBeCloseTo(1.5);
    expect(scale.m00).toBeCloseTo(1.5);
    expect(scale.m11).toBeCloseTo(1.5);
  });

  it("preserves area under rotation (lengthScale = uniform component)", () => {
    // 45° rotation, no scale.
    const c = Math.cos(Math.PI / 4);
    const s = Math.sin(Math.PI / 4);
    const rotated: AffineMatrix = { m00: c, m01: -s, m02: 0, m10: s, m11: c, m12: 0 };
    const scale = resolveEffectBackingScale(rotated, 1);
    expect(scale.lengthScale).toBeCloseTo(1);
  });

  it("handles non-uniform scaling via sqrt(det)", () => {
    // 3x horizontal, 2x vertical → det = 6 → lengthScale = sqrt(6)
    const matrix: AffineMatrix = { m00: 3, m01: 0, m02: 0, m10: 0, m11: 2, m12: 0 };
    const scale = resolveEffectBackingScale(matrix, 1);
    expect(scale.lengthScale).toBeCloseTo(Math.sqrt(6));
    expect(scale.m00).toBeCloseTo(3);
    expect(scale.m11).toBeCloseTo(2);
  });

  it("handles negative determinant (flipped axes)", () => {
    // Horizontal flip — det = -1, |det| = 1.
    const flipped: AffineMatrix = { m00: -1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    const scale = resolveEffectBackingScale(flipped, 1);
    expect(scale.lengthScale).toBeCloseTo(1);
    expect(scale.m00).toBeCloseTo(-1);
    expect(scale.m11).toBeCloseTo(1);
  });
});

describe("applyEffectOffsetScale", () => {
  it("identity transform returns the offset times pixelRatio", () => {
    const scale = resolveEffectBackingScale(IDENTITY, 2);
    const result = applyEffectOffsetScale(scale, 5, -3);
    expect(result.x).toBeCloseTo(10);
    expect(result.y).toBeCloseTo(-6);
  });

  it("uniform-scaled offset multiplies by transform scale and pixelRatio", () => {
    const scale = resolveEffectBackingScale(uniformScale(2), 2);
    // 4x4 effective scale: offset (5, -3) → (20, -12)
    const result = applyEffectOffsetScale(scale, 5, -3);
    expect(result.x).toBeCloseTo(20);
    expect(result.y).toBeCloseTo(-12);
  });

  it("rotates the offset vector under a rotation transform", () => {
    // 90° CCW rotation (Y-down screen → maps (1, 0) → (0, 1))
    const rotated: AffineMatrix = { m00: 0, m01: -1, m02: 0, m10: 1, m11: 0, m12: 0 };
    const scale = resolveEffectBackingScale(rotated, 1);
    const result = applyEffectOffsetScale(scale, 1, 0);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(1);
  });
});
