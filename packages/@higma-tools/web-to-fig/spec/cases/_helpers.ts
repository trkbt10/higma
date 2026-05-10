/**
 * @file Shared narrowing + pipeline helpers for the synthetic
 * `cases/<name>/case.spec.ts` ladder.
 *
 * Each primitive case lives at `cases/<feature>/` with two files:
 *
 *   - `fixture.ts` — exports a *composable* function such as
 *     `withSolidBg(el, color?)` that takes a `RawElement` and returns
 *     a new `RawElement` with one CSS surface applied. Composite
 *     cases (`solid-with-border`, `card-...`) import multiple of
 *     these and apply them in source order — `withBorder(withSolidBg(baseDiv()))`.
 *   - `case.spec.ts` — wraps the result in a single-child viewport,
 *     runs `normalizeViewport` (and `buildDocument` for the cases that
 *     need the FigDesignNode surface), and asserts the per-feature
 *     contract.
 *
 * The helpers here narrow the IR tree (frame/text/vector unwrap) so a
 * spec doesn't duplicate the same `if (kind !== "...")` boilerplate
 * across every case. They never invent values — every helper either
 * returns the requested narrow type or throws.
 */
import type { FrameNodeIR, NodeIR, TextNodeIR, VectorNodeIR, ViewportIR } from "@higma-bridges/web-fig";
import type { FigDesignDocument, FigDesignNode } from "@higma-document-models/fig/domain";
import type { RawElement } from "../../src/web-source/snapshot";
import { buildDocument } from "../../src/emit";
import { normalizeViewport } from "../../src/normalize";
import { synthViewport } from "../synth-snapshot";

/**
 * Wrap a primitive's `RawElement` (from its `fixture.ts`) into a
 * single-child viewport snapshot and run it through `normalizeViewport`.
 * Returns the resulting `ViewportIR` so the case can drill into
 * `ir.root.children[0]` and assert per-feature properties.
 */
export function normalizeOne(el: RawElement): ViewportIR {
  return normalizeViewport(synthViewport({ children: [el] }));
}

/**
 * Run a primitive's `RawElement` through normalize + buildDocument and
 * return the FigDesignDocument plus the IR id → FigNodeId map. Use
 * when the case asserts on the document-io surface (FigDesignNode
 * fills / strokes / cornerRadius / autoLayout) rather than the IR.
 */
export function buildOne(el: RawElement): { readonly doc: FigDesignDocument; readonly ir: ViewportIR } {
  const ir = normalizeOne(el);
  const built = buildDocument(ir);
  return { doc: built.doc, ir };
}

/** Single child of the viewport's root frame. Throws on shape drift. */
export function singleChild(ir: ViewportIR): NodeIR {
  if (ir.root.kind !== "frame") {
    throw new Error("normalizeOne: viewport root is not a frame");
  }
  if (ir.root.children.length !== 1) {
    throw new Error(`normalizeOne: expected 1 child, got ${ir.root.children.length}`);
  }
  return ir.root.children[0]!;
}

/** Narrow a NodeIR to FrameNodeIR or throw with a precise message. */
export function asFrame(node: NodeIR): FrameNodeIR {
  if (node.kind !== "frame") {
    throw new Error(`expected frame, got ${node.kind}`);
  }
  return node;
}

/** Narrow a NodeIR to TextNodeIR or throw. */
export function asText(node: NodeIR): TextNodeIR {
  if (node.kind !== "text") {
    throw new Error(`expected text, got ${node.kind}`);
  }
  return node;
}

/** Narrow a NodeIR to VectorNodeIR or throw. */
export function asVector(node: NodeIR): VectorNodeIR {
  if (node.kind !== "vector") {
    throw new Error(`expected vector, got ${node.kind}`);
  }
  return node;
}

/**
 * Walk the FigDesignDocument's first page and return the first node
 * with the given layer name. Cases reach the synthetic primitive's
 * frame this way because `synthViewport` auto-assigns `<body>` as the
 * outermost layer name.
 */
export function findFigNodeByName(
  doc: FigDesignDocument,
  name: string,
): FigDesignNode | undefined {
  function walk(nodes: readonly FigDesignNode[]): FigDesignNode | undefined {
    for (const node of nodes) {
      if (node.name === name) {
        return node;
      }
      const hit = walk(node.children ?? []);
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }
  return walk(doc.pages[0]!.children);
}
