/**
 * @file Regression — `renderFigToSvg` plumbs `exportSettings` from
 * `FigSvgRenderOptions` through to `resolveRenderTree`.
 *
 * Without the plumbing the SVG-side render call ignored colour-
 * management settings entirely, so any caller — including
 * `fig-to-web`'s figma-svg emitter — that needed to render a real
 * .fig with image paints flagged `imageShouldColorManage` would hit
 * `requireManagedImageColorProfile`'s fail-fast throw with no way to
 * declare the target profile. The lower-level `resolveFill` contract
 * (caller MUST decide the profile) is locked in by
 * `scene-graph/render/render-parity.spec.ts`; this spec guards the
 * SVG renderer's option-forwarding so callers can satisfy that
 * contract from the public API.
 */

import type { FigNode } from "@higma-document-models/fig/types";
import { EMPTY_FIG_STYLE_REGISTRY, indexFigKiwiDocument } from "@higma-document-models/fig/domain";
import { createSymbolResolver } from "@higma-document-models/fig/symbols";
import { renderFigToSvg } from "./renderer";

function createEmptyFrame(): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: { value: 0, name: "CREATED" },
    type: { value: 3, name: "FRAME" },
    name: "Frame",
    visible: true,
    opacity: 1,
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    size: { x: 10, y: 10 },
  } as FigNode;
}

describe("renderFigToSvg exportSettings plumbing", () => {
  it("accepts an explicit exportSettings.colorProfile and renders without throwing", async () => {
    const document = indexFigKiwiDocument([]);
    const result = await renderFigToSvg([createEmptyFrame()], {
      width: 10,
      height: 10,
      viewport: { x: 0, y: 0, width: 10, height: 10 },
      sourceDocumentReference: document,
      sourceRevision: 0,
      blobs: [],
      images: new Map(),
      childrenOf: () => [],
      symbolResolver: createSymbolResolver({
        document,
      }),
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      exportSettings: { colorProfile: "SRGB" },
    });
    expect(String(result.svg)).toContain("<svg");
  });

  it("throws fail-fast when an unsupported `displayP3IccProfile` is requested without bytes", async () => {
    const document = indexFigKiwiDocument([]);
    // Routing the option through the resolver is what surfaces
    // the P3-without-ICC fail-fast guard
    // for callers that omit the ICC bytes. Reaching this throw confirms
    // `exportSettings` is consumed by the render-tree resolver, not
    // silently dropped.
    await expect(renderFigToSvg([createEmptyFrame()], {
      width: 10,
      height: 10,
      viewport: { x: 0, y: 0, width: 10, height: 10 },
      sourceDocumentReference: document,
      sourceRevision: 0,
      blobs: [],
      images: new Map(),
      childrenOf: () => [],
      symbolResolver: createSymbolResolver({
        document,
      }),
      styleRegistry: EMPTY_FIG_STYLE_REGISTRY,
      exportSettings: { colorProfile: "DISPLAY_P3_V4" },
    })).rejects.toThrow("Display P3 image export requires explicit exportSettings.displayP3IccProfile");
  });
});
