/**
 * @file Web ↔ Fig round-trip contract.
 *
 * Pipeline under test:
 *
 *   exampleComFixture (RawViewportSnapshot)
 *       │ normalizeViewport
 *       ▼
 *     ViewportIR (`ir1`)
 *       │ buildDocument → exportFig → bytes
 *       │ createFigDocumentContext(bytes)
 *       │ inspect Kiwi root frame directly
 *       ▼
 *     Kiwi root frame summary
 *
 * The contract: `ir1.root` and the reloaded Kiwi root agree on the
 * diff-relevant subset (kind, name, box, paint counts, characters,
 * autoLayout direction, child count) at every level. Anything stricter would
 * trip on Figma's id reassignment and on fields outside this bridge's
 * visual contract — those are out of scope for the bridge,
 * which only claims invariance on the *visual surface*.
 *
 * Asset round-trip is asserted separately for the (currently empty)
 * fixture: the exported document carries the same asset ids the IR
 * declared.
 *
 * The spec runs entirely in memory — no Playwright, no network — by
 * starting from a hand-built RawViewportSnapshot.
 */
import { createFigDocumentContext, type FigDocumentContext } from "@higma-document-io/fig";
import type { NodeIR } from "@higma-bridges/web-fig";
import type { FigNode } from "@higma-document-models/fig/types";
import { normalizeViewport } from "../src/normalize";
import { emitFig, buildDocument } from "../src/emit";
import { exampleComFixture } from "./example-com-fixture";
import { staticFontResolver } from "./test-font-resolver";

function summarize(node: NodeIR): unknown {
  return {
    kind: node.kind,
    name: node.name,
    box: roundBox(node.box),
    fills: node.style.fills.length,
    strokes: node.style.strokes.length,
    autoLayout: node.kind === "frame" ? node.autoLayout.direction : undefined,
    children: node.kind === "frame" ? node.children.map(summarize) : undefined,
    characters: node.kind === "text" ? node.characters : undefined,
  };
}

function roundBox(b: NodeIR["box"]): NodeIR["box"] {
  return {
    x: round(b.x),
    y: round(b.y),
    width: round(b.width),
    height: round(b.height),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function documentCanvas(context: FigDocumentContext): FigNode {
  const canvases = context.document.nodeChanges.filter((node) => node.type.name === "CANVAS" && node.internalOnly !== true);
  if (canvases.length !== 1) {
    throw new Error(`expected exactly one visible CANVAS, got ${canvases.length}`);
  }
  return canvases[0]!;
}

function directKiwiSummary(context: FigDocumentContext, node: FigNode): unknown {
  const transform = node.transform;
  const size = node.size;
  if (transform === undefined) {
    throw new Error(`node ${node.name ?? node.type.name} missing transform`);
  }
  if (size === undefined) {
    throw new Error(`node ${node.name ?? node.type.name} missing size`);
  }
  const kind = (() => {
    switch (node.type.name) {
      case "FRAME":
      case "SYMBOL":
      case "GROUP":
      case "SECTION":
        return "frame";
      case "TEXT":
        return "text";
      case "RECTANGLE":
      case "ROUNDED_RECTANGLE":
      case "ELLIPSE":
        return "rectangle";
      case "VECTOR":
      case "LINE":
      case "STAR":
      case "REGULAR_POLYGON":
        return "vector";
      default:
        throw new Error(`unsupported Kiwi node type in round-trip summary: ${node.type.name}`);
    }
  })();
  return {
    kind,
    name: node.name,
    box: roundBox({
      x: transform.m02,
      y: transform.m12,
      width: size.x,
      height: size.y,
    }),
    fills: (node.fillPaints ?? []).length,
    strokes: (node.strokePaints ?? []).length,
    autoLayout: kind === "frame" ? directAutoLayoutDirection(node) : undefined,
    children: kind === "frame" ? context.document.childrenOf(node).map((child) => directKiwiSummary(context, child)) : undefined,
    characters: kind === "text" ? node.textData?.characters : undefined,
  };
}

function directAutoLayoutDirection(node: FigNode): "row" | "column" | "none" {
  const modeName = node.stackMode?.name;
  switch (modeName) {
    case "HORIZONTAL":
      return "row";
    case "VERTICAL":
      return "column";
    case undefined:
    case "NONE":
      return "none";
    default:
      throw new Error(`unsupported Kiwi stackMode in round-trip summary: ${modeName}`);
  }
}

describe("web-to-fig round-trip", () => {
  it("normalizes the example.com fixture into IR", () => {
    const ir = normalizeViewport(exampleComFixture, { fontResolver: staticFontResolver() });
    expect(ir.source).toBe("https://example.com/");
    expect(ir.box.width).toBe(1280);
    expect(ir.root.kind).toBe("frame");
    if (ir.root.kind !== "frame") {
      throw new Error();
    }
    expect(ir.root.children).toHaveLength(1);
    const card = ir.root.children[0]!;
    expect(card.kind).toBe("frame");
    if (card.kind !== "frame") {
      throw new Error();
    }
    // Three children: h1, p, p (each becomes a TEXT IR node).
    expect(card.children).toHaveLength(3);
    expect(card.children[0]!.kind).toBe("text");
    if (card.children[0]!.kind !== "text") {
      throw new Error();
    }
    expect(card.children[0]!.characters).toBe("Example Domain");
  });

  it("infers a vertical auto-layout for the card's stacked children", () => {
    const ir = normalizeViewport(exampleComFixture, { fontResolver: staticFontResolver() });
    if (ir.root.kind !== "frame") {
      throw new Error();
    }
    const card = ir.root.children[0]!;
    if (card.kind !== "frame") {
      throw new Error();
    }
    expect(card.autoLayout.direction).toBe("column");
  });

  it("builds an exportable Kiwi document from the IR", () => {
    const ir = normalizeViewport(exampleComFixture, { fontResolver: staticFontResolver() });
    const built = buildDocument(ir);
    const page = documentCanvas(built.context);
    const pageChildren = built.context.document.childrenOf(page);
    const nodeCount = pageChildren.reduce<number>((acc, child) => {
      return acc + directKiwiSubtreeSize(built.context, child);
    }, 0);
    // viewport root + card + 3 texts = 5
    expect(nodeCount).toBe(5);
  });

  it("preserves the IR's structural shape after Web → IR → Fig → Kiwi", async () => {
    const ir1 = normalizeViewport(exampleComFixture, { fontResolver: staticFontResolver() });
    const exported = await emitFig(ir1);
    expect(exported.bytes.byteLength).toBeGreaterThan(0);

    const reloaded = await createFigDocumentContext(exported.bytes);
    const page = documentCanvas(reloaded);
    const rootChildren = reloaded.document.childrenOf(page);
    expect(rootChildren).toHaveLength(1);

    const summary1 = summarize(ir1.root);
    const summary2 = directKiwiSummary(reloaded, rootChildren[0]!);

    expect(summary2).toEqual(summary1);
  });
});

function directKiwiSubtreeSize(context: FigDocumentContext, node: FigNode): number {
  return 1 + context.document.childrenOf(node).reduce<number>((acc, child) => {
    return acc + directKiwiSubtreeSize(context, child);
  }, 0);
}
