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
  };
}

const EMPTY_REGISTRY: EmitRegistry = {
  frames: new Map(),
  components: new Map(),
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
