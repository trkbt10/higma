/**
 * @file Integration spec for `layoutSizing: "liquid"` through the real
 * emitter (`emitPageFile`). Proves the liquid overlay is spliced onto
 * the generated TSX: horizontal lengths become `%`, the page root gains
 * the full-bleed `width: 100%` + capped `max-width` shell, and — the key
 * invariant — at the authored width each `%` resolves back to the exact
 * px the fixed emit produces (200px ⇒ 22.22% of the 900px content box,
 * 40px gap ⇒ 4.44%, 50px padding ⇒ 5% of the 1000px root).
 *
 * The fixed-mode counterpart asserts the output is unchanged: absolute
 * px, no `%`, no wrapper.
 */
import { describe, it, expect } from "vitest";
import type { FigNode, FigMatrix, KiwiEnumValue } from "@higma-document-models/fig/types";
import type { FrameTarget, EmitRegistry } from "../types";
import type { TokenIndex } from "../../tokens";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig/context";
import type { EmitOpts } from "./files";
import { emitPageFile } from "./files";
import type { LayoutSizing } from "../orchestrate";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

const ROOT_GUID = { sessionID: 1, localID: 1 };

function at(x: number): FigMatrix {
  return { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: 0 };
}

/**
 * 1000×200 horizontal auto-layout row: 50px L/R padding (content =
 * 900), 40px gap, three 200×100 FIXED cards.
 */
function buildRowScene(): { source: ReturnType<typeof createFigDocumentContextFromNodeChanges>; target: FrameTarget } {
  const root: FigNode = {
    guid: ROOT_GUID,
    phase: enumName("CREATED"),
    type: enumName("FRAME"),
    name: "row",
    size: { x: 1000, y: 200 },
    stackMode: enumName("HORIZONTAL"),
    stackHorizontalPadding: 50,
    stackSpacing: 40,
  } as FigNode;
  const cards: FigNode[] = [0, 1, 2].map(
    (i) =>
      ({
        guid: { sessionID: 1, localID: 10 + i },
        parentIndex: { guid: ROOT_GUID, position: String.fromCharCode(33 + i) },
        phase: enumName("CREATED"),
        type: enumName("FRAME"),
        name: `card-${i}`,
        size: { x: 200, y: 100 },
        transform: at(50 + i * 240),
      }) as FigNode,
  );
  const source = createFigDocumentContextFromNodeChanges({
    nodeChanges: [root, ...cards],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
  return {
    source,
    target: {
      node: root,
      componentName: "Row",
      filePath: "pages/page/row.tsx",
      slug: "row",
      canvasSlug: "page",
    },
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

function makeOpts(layoutSizing: LayoutSizing): EmitOpts {
  return {
    debugAttrs: false,
    imageResolver: () => undefined,
    exportStyle: "function-default",
    cssMode: "inline",
    cssImport: "direct",
    externalCssRegistry: undefined,
    externalStylesheetPath: "styles.css",
    variantStrategy: "discriminated",
    assetStrategy: "inline",
    assetComplexityThreshold: 200,
    iconRegistry: undefined,
    layoutSizing,
  };
}

function pageContents(layoutSizing: LayoutSizing): string {
  const { source, target } = buildRowScene();
  const files = emitPageFile(source, EMPTY_REGISTRY, EMPTY_TOKEN_INDEX, target, makeOpts(layoutSizing));
  const page = files.find((f) => f.path === target.filePath);
  if (!page) {
    throw new Error(`expected emit to produce ${target.filePath}`);
  }
  return page.contents;
}

describe("emitPageFile — layoutSizing: liquid", () => {
  it("rewrites horizontal lengths to % and wraps the page root full-bleed", () => {
    const contents = pageContents("liquid");
    // Full-bleed shell: outer width:100% + minHeight, inner max-width + centred.
    expect(contents).toMatch(/maxWidth:\s*"1000px"/);
    expect(contents).toMatch(/marginLeft:\s*"auto"/);
    expect(contents).toMatch(/marginRight:\s*"auto"/);
    expect(contents).toMatch(/width:\s*"100%"/);
    expect(contents).toMatch(/minHeight:\s*"200px"/);
    // Container horizontal padding (50 / 1000) and gap (40 / 900 content).
    expect(contents).toMatch(/paddingLeft:\s*"5%"/);
    expect(contents).toMatch(/columnGap:\s*"4\.44%"/);
    expect(contents).toMatch(/rowGap:\s*"40px"/);
    // FIXED card widths (200 / 900 content box).
    expect(contents).toMatch(/width:\s*"22\.22%"/);
    // The root no longer pins an absolute width.
    expect(contents).not.toMatch(/width:\s*"1000px"/);
  });
});

describe("emitPageFile — layoutSizing: fixed (unchanged)", () => {
  it("keeps absolute px and emits no liquid shell", () => {
    const contents = pageContents("fixed");
    expect(contents).toMatch(/width:\s*"1000px"/); // root pinned
    expect(contents).toMatch(/width:\s*"200px"/); // cards pinned
    expect(contents).not.toMatch(/%"/); // no percentage anywhere
    expect(contents).not.toMatch(/maxWidth/);
  });
});
