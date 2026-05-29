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
import type { FigNode, FigMatrix, KiwiEnumValue } from "@higma-document-models/fig/types";
import type { FrameTarget, EmitRegistry } from "../types";
import type { TokenIndex } from "../../tokens";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig/context";
import type { EmitOpts } from "./files";
import { emitPageFile } from "./files";
import type { LayoutSizing } from "../layout/sizing";

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
  it("rewrites every length to a fluid calc against the --lqd scale unit", () => {
    const contents = pageContents("liquid");
    // Scale unit seeded on the root (design width 1000 ⇒ min(1vw, 10px)).
    expect(contents).toMatch(/min\(1vw, 10px\)/);
    // Root: fluid width capped+centred (1000 ⇒ factor 100), growable height.
    expect(contents).toMatch(/calc\(100 \* var\(--lqd\)\)/);
    expect(contents).toMatch(/marginLeft:\s*"auto"/);
    expect(contents).toMatch(/minHeight:\s*"calc\(20 \* var\(--lqd\)\)"/); // height 200 ⇒ 20
    // Cards (200 ⇒ 20) and gap (40 ⇒ 4) scale by the same unit.
    expect(contents).toMatch(/calc\(20 \* var\(--lqd\)\)/);
    expect(contents).toMatch(/calc\(4 \* var\(--lqd\)\)/);
    // No raw px dimensions survive.
    expect(contents).not.toMatch(/width:\s*"1000px"/);
    expect(contents).not.toMatch(/width:\s*"200px"/);
  });
});

describe("emitPageFile — layoutSizing: fixed (unchanged)", () => {
  it("keeps absolute px and emits no fluid units", () => {
    const contents = pageContents("fixed");
    expect(contents).toMatch(/width:\s*"1000px"/); // root pinned
    expect(contents).toMatch(/width:\s*"200px"/); // cards pinned
    expect(contents).not.toMatch(/var\(--lqd\)/);
    expect(contents).not.toMatch(/calc\(/);
  });
});

/**
 * A 1440×900 clipping frame whose two children overlap on Y, so layout
 * inference declines and the children stay absolutely positioned. In
 * fixed mode the root pins `height: 900px` + `overflow: hidden`.
 */
function buildClippedStaticScene(): { source: ReturnType<typeof createFigDocumentContextFromNodeChanges>; target: FrameTarget } {
  const root: FigNode = {
    guid: ROOT_GUID,
    phase: enumName("CREATED"),
    type: enumName("FRAME"),
    name: "canvas",
    size: { x: 1440, y: 900 },
    clipsContent: true,
  } as FigNode;
  const boxes: FigNode[] = [0, 1].map(
    (i) =>
      ({
        guid: { sessionID: 1, localID: 20 + i },
        parentIndex: { guid: ROOT_GUID, position: String.fromCharCode(33 + i) },
        phase: enumName("CREATED"),
        type: enumName("FRAME"),
        name: `box-${i}`,
        size: { x: 400, y: 300 },
        transform: { m00: 1, m01: 0, m02: 100 + i * 20, m10: 0, m11: 1, m12: 100 + i * 20 },
      }) as FigNode,
  );
  const source = createFigDocumentContextFromNodeChanges({
    nodeChanges: [root, ...boxes],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
  return {
    source,
    target: { node: root, componentName: "Canvas", filePath: "pages/page/canvas.tsx", slug: "canvas", canvasSlug: "page" },
  };
}

describe("emitPageFile — liquid page root must not collapse or clip (regression)", () => {
  function contentsFor(layoutSizing: LayoutSizing): string {
    const { source, target } = buildClippedStaticScene();
    const files = emitPageFile(source, EMPTY_REGISTRY, EMPTY_TOKEN_INDEX, target, makeOpts(layoutSizing));
    const page = files.find((f) => f.path === target.filePath);
    if (!page) {
      throw new Error(`expected emit to produce ${target.filePath}`);
    }
    return page.contents;
  }

  it("fixed mode pins the authored height and clips (baseline)", () => {
    const contents = contentsFor("fixed");
    expect(contents).toMatch(/height:\s*"900px"/);
    expect(contents).toMatch(/overflow:\s*"hidden"/);
  });

  it("liquid mode grows instead of clipping and scales every length uniformly", () => {
    const contents = contentsFor("liquid");
    // Isolate the page-root div's own style. Only the root carries the
    // `--lqd` custom property, which makes the serializer cast the style
    // literal `… as React.CSSProperties` — a marker unique to the root.
    const rootStyle = contents.match(/<div style=\{\{([^}]*)\} as React\.CSSProperties\}>/);
    expect(rootStyle).not.toBeNull();
    const rootStyleBody = rootStyle?.[1] ?? "";
    // Scale unit seeded; fluid width capped+centred; the authored height
    // becomes a growable floor — never `height: 0`; the page never clips.
    expect(rootStyleBody).toContain("min(1vw, 14.4px)"); // W / 100
    expect(rootStyleBody).toContain("calc(100 * var(--lqd))"); // width 1440
    expect(rootStyleBody).toContain('marginLeft: "auto"');
    expect(rootStyleBody).not.toContain("overflow");
    expect(rootStyleBody).not.toContain('height: "900px"');
    // The positioning context for the absolute children survives.
    expect(rootStyleBody).toContain('position: "relative"');
    // Absolute children scale uniformly on BOTH axes (left/top 100 ⇒ 6.9444,
    // width 400 ⇒ 27.7778), so they keep their aspect ratio and position.
    expect(contents).toMatch(/calc\(6\.9444 \* var\(--lqd\)\)/);
    expect(contents).toMatch(/calc\(27\.7778 \* var\(--lqd\)\)/);
    expect(contents).not.toMatch(/left:\s*"100px"/);
  });
});
