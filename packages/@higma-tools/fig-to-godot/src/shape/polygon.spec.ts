/**
 * @file Spec for the shape-contour synthesis pipeline. Locks in the
 * arc/donut decoding because the fig binary often omits angles for
 * full-sweep donuts, and the previous NaN-propagation produced an
 * empty Polygon2D that silently rendered as transparent
 * (`ellipse-donut` showed 25.31% diff against the WebGL reference).
 */
import type { FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import { decodeNodeContours } from "./polygon";

type ArcData = NonNullable<FigNode["arcData"]>;

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function ellipse(partial: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("ELLIPSE"),
    size: { x: 80, y: 80 },
    ...partial,
  } as FigNode;
}

function arcDataOf(partial: Partial<ArcData>): ArcData {
  return partial as ArcData;
}

describe("decodeNodeContours — ELLIPSE arc/donut", () => {
  it("produces a non-empty ring contour for a full-sweep donut (arcData with innerRadius only)", () => {
    // Figma stores `innerRadius` and OMITS startingAngle/endingAngle
    // when the ring is unsliced. The decoder must default the missing
    // angles to 0/2π rather than propagating undefined into the sweep
    // computation. The on-disk symptom of the bug was a
    // PackedVector2Array() empty polygon on the emit side.
    const node = ellipse({ arcData: arcDataOf({ innerRadius: 0.5 }) });
    const contours = decodeNodeContours(node, []);
    expect(contours.length).toBeGreaterThan(0);
    // Full-sweep donuts emit a merged+partition contour + two
    // outline-only rings (outer + inner).
    const fillContour = contours.find((c) => c.partition !== undefined);
    expect(fillContour).toBeDefined();
    expect(fillContour!.points.length).toBeGreaterThan(0);
    for (const p of fillContour!.points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // Outline-only rings exist for stroke emission.
    const outlines = contours.filter((c) => c.outlineOnly === true);
    expect(outlines.length).toBe(2);
  });

  it("produces a pie-slice contour for a partial arc with explicit angles (no innerRadius)", () => {
    const node = ellipse({
      arcData: arcDataOf({ startingAngle: 0, endingAngle: Math.PI }),
    });
    const contours = decodeNodeContours(node, []);
    expect(contours.length).toBe(1);
    expect(contours[0].points.length).toBeGreaterThan(0);
    for (const p of contours[0].points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("produces a partial-donut wedge for an arc with both angles and innerRadius", () => {
    const node = ellipse({
      arcData: arcDataOf({
        startingAngle: 0,
        endingAngle: Math.PI / 2,
        innerRadius: 0.5,
      }),
    });
    const contours = decodeNodeContours(node, []);
    expect(contours.length).toBe(1);
    expect(contours[0].points.length).toBeGreaterThan(0);
    for (const p of contours[0].points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("produces a single full-ellipse contour when arcData is absent", () => {
    const node = ellipse({});
    const contours = decodeNodeContours(node, []);
    expect(contours.length).toBe(1);
    expect(contours[0].points.length).toBe(96);
  });
});
