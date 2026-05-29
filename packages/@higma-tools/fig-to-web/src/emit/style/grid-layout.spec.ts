/**
 * @file Pin Figma GRID auto-layout → CSS Grid emission.
 *
 * A frame with `stackMode === GRID` carries explicit column / row
 * track sizing, per-axis gaps, and padding. Pre-fix the emitter had
 * no GRID branch: the frame fell through to the inferred-layout /
 * row-clustering path and rendered as nested flex rows with a computed
 * (wrong) gap, so each card sat at its SYMBOL-authored width with an
 * oversized gap instead of filling its 1fr column. Post-fix the frame
 * emits `display: grid` with `grid-template-columns` from the FLEX
 * track sizing and the authored gap, and STRETCH children fill their
 * cells (no pinned width).
 */
import type { FigNode, KiwiEnumValue, FigMatrix } from "@higma-document-models/fig/types";
import type { FrameTarget, EmitRegistry } from "../types";
import type { TokenIndex } from "../../tokens";
import { createFigDocumentContextFromNodeChanges } from "@higma-document-io/fig/context";
import type { EmitOpts } from "../render/files";
import { emitPageFile } from "../render/files";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

const ORIGIN: FigMatrix = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

function flexTrack(localID: number): unknown {
  return {
    id: { sessionID: 1, localID },
    trackSize: {
      minSizing: { type: { value: 0, name: "FLEX" }, value: 1 },
      maxSizing: { type: { value: 0, name: "FLEX" }, value: 1 },
    },
  };
}

/**
 * A 1200×800 GRID frame with 3 FLEX columns, 20px gaps, 40px L/R
 * padding, and three 360×340 STRETCH children (the card pattern).
 * Content width = 1200 − 80 = 1120; three 1fr columns with two 20px
 * gaps → 360px per column, so a child authored at 360 should fill its
 * cell without a pinned width.
 */
function buildGridScene(): {
  readonly source: ReturnType<typeof createFigDocumentContextFromNodeChanges>;
  readonly target: FrameTarget;
} {
  const grid: FigNode = {
    guid: { sessionID: 1, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("FRAME"),
    name: "card-grid",
    size: { x: 1200, y: 800 },
    stackMode: enumName("GRID"),
    stackHorizontalPadding: 40,
    gridColumnGap: 20,
    gridRowGap: 20,
    gridColumnsSizing: { entries: [flexTrack(0), flexTrack(1), flexTrack(2)] as never },
  } as FigNode;
  const children: FigNode[] = [0, 1, 2].map(
    (i) =>
      ({
        guid: { sessionID: 1, localID: 10 + i },
        parentIndex: { guid: { sessionID: 1, localID: 1 }, position: String.fromCharCode(33 + i) },
        phase: enumName("CREATED"),
        type: enumName("FRAME"),
        name: `cell-${i}`,
        size: { x: 360, y: 340 },
        transform: ORIGIN,
      }) as FigNode,
  );
  const source = createFigDocumentContextFromNodeChanges({
    nodeChanges: [grid, ...children],
    blobs: [],
    images: new Map(),
    metadata: null,
  });
  return {
    source,
    target: {
      node: grid,
      componentName: "CardGrid",
      filePath: "pages/page/card-grid.tsx",
      slug: "card-grid",
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

describe("emitPageFile — Figma GRID auto-layout becomes CSS Grid", () => {
  function pageContents(): string {
    const { source, target } = buildGridScene();
    const files = emitPageFile(source, EMPTY_REGISTRY, EMPTY_TOKEN_INDEX, target, makeOpts());
    const page = files.find((f) => f.path === target.filePath);
    if (!page) {
      throw new Error(`expected emit to produce ${target.filePath}`);
    }
    return page.contents;
  }

  it("emits display: grid with FLEX columns as minmax(0, 1fr) tracks", () => {
    const contents = pageContents();
    expect(contents).toMatch(/display:\s*"grid"/);
    expect(contents).toContain('gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)"');
  });

  it("emits the authored 20px gap and 40px horizontal padding", () => {
    const contents = pageContents();
    expect(contents).toMatch(/gap:\s*"20px"/);
    expect(contents).toContain('padding: "0 40px 0 40px"');
  });

  it("does NOT pin a STRETCH grid child to its authored width (it fills the 1fr cell)", () => {
    const contents = pageContents();
    // The cells are authored 360px wide, but a STRETCH grid item must
    // fill its track. A literal `width: "360px"` on a grid child would
    // re-introduce the gap a wider cell leaves.
    expect(contents).not.toContain('width: "360px"');
  });

  it("does not fall back to nested flex rows with a computed gap", () => {
    const contents = pageContents();
    expect(contents).not.toMatch(/flexDirection:\s*"row"/);
  });
});
