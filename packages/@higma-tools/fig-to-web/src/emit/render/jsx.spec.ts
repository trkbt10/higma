/**
 * @file Regression pin for rotation preservation under autolayout flow.
 *
 * The emitter previously dropped a node's entire `transform` matrix
 * whenever the node flowed inside an autolayout (`display: flex`)
 * parent. Translation suppression was correct (flex owns positioning)
 * but the rotation / scale / skew components got dropped with it, so
 * a rotated rectangle inside an autolayout frame rendered axis-aligned.
 * The visual harness surfaced this against `rectangle.fig`'s
 * `rect-rotated` frame at 22.10% pixel diff vs the authoritative SVG.
 *
 * `transformFromMatrix` already strips translation (the CSS `matrix(…)`
 * it emits hardcodes the last two slots to zero) — flex-flow children
 * with a pure translation matrix still emit no `transform` style. So
 * `transformForNode` does not need an autolayout-aware short-circuit;
 * pinning that here keeps future refactors from re-introducing one.
 */
import type { FigNode, KiwiEnumValue, FigMatrix } from "@higma-document-models/fig/types";
import type { FrameTarget, EmitRegistry } from "../types";
import type { TokenIndex } from "../../tokens";
import type { FigDocumentContext } from "@higma-document-io/fig/context";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig/context";
import type { EmitOpts } from "./files";
import { emitPageFile } from "./files";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function buildScene(childTransform: FigMatrix | undefined): {
  readonly source: FigDocumentContext;
  readonly target: FrameTarget;
} {
  const parent: FigNode = {
    guid: { sessionID: 1, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("FRAME"),
    name: "rotated-in-flex",
    size: { x: 200, y: 200 },
    stackMode: enumName("HORIZONTAL"),
  } as FigNode;
  const child: FigNode = {
    guid: { sessionID: 1, localID: 2 },
    parentIndex: { guid: { sessionID: 1, localID: 1 }, position: "V" },
    phase: enumName("CREATED"),
    type: enumName("RECTANGLE"),
    name: "rotated-rect",
    size: { x: 120, y: 80 },
    transform: childTransform,
  } as FigNode;
  const source = createFigDocumentContextFromNodeChanges({
    nodeChanges: [parent, child],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
  return {
    source,
    target: {
      node: parent,
      componentName: "RotatedInFlex",
      filePath: "pages/page/rotated.tsx",
      slug: "rotated",
      canvasSlug: "page",
    },
  };
}

function makeOpts(): EmitOpts {
  return {
    debugAttrs: false,
    imageResolver: () => undefined,
    exportStyle: "function-default",
    cssMode: "inline",
    cssImport: "direct",
    externalCssRegistry: undefined,
    externalStylesheetPath: "styles.css",
    variantStrategy: "exploded",
    assetStrategy: "inline",
    assetComplexityThreshold: 200,
    iconRegistry: undefined,
    layoutSizing: "fixed",
  };
}

const EMPTY_REGISTRY: EmitRegistry = {
  frames: new Map(),
  components: new Map(),
  imageFillOverrideTargets: new Set(),
  fontSizeOverrideTargets: new Set(),
  visibleOverrideTargets: new Set(),
};
const EMPTY_TOKEN_INDEX: TokenIndex = {
  colorIdForPaints: () => undefined,
  spacingIdFor: () => undefined,
  radiusIdFor: () => undefined,
  shadowIdFor: () => undefined,
  typographyIdFor: () => undefined,
};

const ROTATION_90: FigMatrix = {
  m00: 0,
  m01: -1,
  m02: 0,
  m10: 1,
  m11: 0,
  m12: 0,
};

const TRANSLATION_ONLY: FigMatrix = {
  m00: 1,
  m01: 0,
  m02: 40,
  m10: 0,
  m11: 1,
  m12: 60,
};

/**
 * Synthesise a 100×100 root frame carrying a single image paint whose
 * `paint.transform` is supplied by the caller. Lets each spec test the
 * emission path (background-image vs structural <img>) deterministically.
 */
function buildImagePaintScene(paintTransform: FigMatrix): {
  readonly source: FigDocumentContext;
  readonly target: FrameTarget;
} {
  const imageHash = [0xab, 0xcd, 0xef];
  const root: FigNode = {
    guid: { sessionID: 2, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("ROUNDED_RECTANGLE"),
    name: "image-host",
    size: { x: 100, y: 100 },
    fillPaints: [
      {
        type: enumName("IMAGE"),
        opacity: 1,
        visible: true,
        blendMode: enumName("NORMAL"),
        imageScaleMode: enumName("STRETCH"),
        image: { hash: imageHash },
        transform: paintTransform,
      },
    ],
  } as unknown as FigNode;
  const source = createFigDocumentContextFromNodeChanges({
    nodeChanges: [root],
    blobs: [],
    images: new Map([
      [
        imageHash.map((b) => b.toString(16).padStart(2, "0")).join(""),
        { hash: imageHash, data: new Uint8Array([0]), mimeType: "image/png" },
      ],
    ]),
    metadata: null,
  });
  return {
    source,
    target: {
      node: root,
      componentName: "ImageHost",
      filePath: "pages/page/image-host.tsx",
      slug: "image-host",
      canvasSlug: "page",
    },
  };
}

function makeImagePaintOpts(): EmitOpts {
  return {
    ...makeOpts(),
    imageResolver: () => "/assets/test.png",
  };
}

describe("emitPageFile — image paint with rotated transform falls back to structural <img>", () => {
  it("emits a child <img> with a CSS matrix transform instead of a degraded background", () => {
    // +30° rotation paint transform — CSS background-image cannot
    // represent the rotation, so the emitter must produce
    // `<div ...><img transform=matrix(...)/></div>` and the container
    // must carry `position: relative` and `overflow: hidden` so the
    // absolutely-positioned image is clipped to the node's bounds.
    const cos30 = Math.cos(Math.PI / 6);
    const sin30 = Math.sin(Math.PI / 6);
    const { source, target } = buildImagePaintScene({
      m00: cos30,
      m01: -sin30,
      m02: 0,
      m10: sin30,
      m11: cos30,
      m12: 0,
    });
    const files = emitPageFile(source, EMPTY_REGISTRY, EMPTY_TOKEN_INDEX, target, makeImagePaintOpts());
    const page = files.find((f) => f.path === target.filePath);
    if (!page) {
      throw new Error(`expected emit to produce ${target.filePath}`);
    }
    // A structural <img> must appear with the resolved asset URL.
    expect(page.contents).toContain('<img src="/assets/test.png"');
    // ... carrying the CSS matrix transform with rotation components.
    expect(page.contents).toMatch(/transform:\s*"matrix\(/);
    // The container has been promoted to a positioning context and
    // clips the image, so the absolutely-positioned <img> stays inside
    // the Figma node's bounds (including any borderRadius).
    expect(page.contents).toMatch(/position:\s*"relative"/);
    expect(page.contents).toMatch(/overflow:\s*"hidden"/);
    // And the image paint is NOT also dragged through the background
    // layer stack — that would double-paint and visibly bleed under
    // the rotated foreground.
    expect(page.contents).not.toContain("backgroundImage:");
  });

  it("leaves an axis-aligned crop on the CSS background path (no structural <img>)", () => {
    // Axis-aligned m01 = m10 = 0 means CSS `background-size` /
    // `background-position` can faithfully express the crop, so the
    // emitter must NOT promote to a structural <img>.
    const { source, target } = buildImagePaintScene({
      m00: 0.8,
      m01: 0,
      m02: 0.1,
      m10: 0,
      m11: 0.6,
      m12: 0.05,
    });
    const files = emitPageFile(source, EMPTY_REGISTRY, EMPTY_TOKEN_INDEX, target, makeImagePaintOpts());
    const page = files.find((f) => f.path === target.filePath);
    if (!page) {
      throw new Error(`expected emit to produce ${target.filePath}`);
    }
    expect(page.contents).toContain("backgroundImage: \"url('/assets/test.png')\"");
    expect(page.contents).not.toMatch(/<img\s+src="\/assets\/test\.png"/);
  });
});

describe("emitPageFile — transform emission for autolayout children", () => {
  it("preserves a rotated child's matrix when the parent is autolayout (flex)", () => {
    const { source, target } = buildScene(ROTATION_90);
    const files = emitPageFile(source, EMPTY_REGISTRY, EMPTY_TOKEN_INDEX, target, makeOpts());
    const page = files.find((f) => f.path === target.filePath);
    if (!page) {
      throw new Error(`expected emit to produce ${target.filePath}`);
    }
    expect(page.contents).toMatch(/display:\s*"flex"/);
    // `transformFromMatrix` writes `matrix(m00, m10, m01, m11, 0, 0)`.
    // For a 90° rotation that is `matrix(0, 1, -1, 0, 0, 0)`.
    expect(page.contents).toContain("matrix(0, 1, -1, 0, 0, 0)");
    // The rotation pivot must be the authored (0,0) corner so the
    // child rotates around the same origin Figma's matrix encodes.
    expect(page.contents).toMatch(/transformOrigin:\s*"0 0"/);
  });

  it("does not emit a transform when the child's matrix is pure translation under flex flow", () => {
    const { source, target } = buildScene(TRANSLATION_ONLY);
    const files = emitPageFile(source, EMPTY_REGISTRY, EMPTY_TOKEN_INDEX, target, makeOpts());
    const page = files.find((f) => f.path === target.filePath);
    if (!page) {
      throw new Error(`expected emit to produce ${target.filePath}`);
    }
    // Translation slots are owned by the flex parent (padding / gap),
    // so the child must not also drag the translation through CSS
    // `transform` — that would double-position it. `transformFromMatrix`
    // returning `undefined` for identity 2x2 keeps the style clean.
    expect(page.contents).not.toContain("transform:");
    expect(page.contents).not.toContain("transformOrigin:");
  });
});
