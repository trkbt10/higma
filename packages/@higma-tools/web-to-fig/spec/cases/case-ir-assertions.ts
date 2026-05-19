/**
 * @file Shared narrowing + pipeline functions for the synthetic
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
 *     need the Kiwi document surface), and asserts the per-feature
 *     contract.
 *
 * The functions here narrow the IR tree (frame/text/vector unwrap) so a
 * spec doesn't duplicate the same `if (kind !== "...")` boilerplate
 * across every case. They never invent values — every function either
 * returns the requested narrow type or throws.
 */
import type { FrameNodeIR, NodeIR, TextNodeIR, VectorNodeIR, ViewportIR } from "@higma-bridges/web-fig";
import type { FigDocumentContext } from "@higma-document-io/fig";
import type { FigNode } from "@higma-document-models/fig/types";
import type { RawElement } from "../../src/web-source/snapshot";
import type { FontResolver } from "../../src/normalize/font-resolver";
import { buildDocument } from "../../src/emit";
import { normalizeViewport } from "../../src/normalize";
import { synthViewport } from "../synth-snapshot";
import { staticFontResolver } from "../test-font-resolver";

/**
 * Wrap a primitive's `RawElement` (from its `fixture.ts`) into a
 * single-child viewport snapshot and run it through `normalizeViewport`.
 * Returns the resulting `ViewportIR` so the case can drill into
 * `ir.root.children[0]` and assert per-feature properties.
 *
 * `fontResolver` defaults to `staticFontResolver()` (returns
 * `"Test Sans"`) so primitives that don't care about which font name
 * lands in the IR don't have to thread one through. Cases that *do*
 * care about font selection — `font-stack-resolves-via-resolver`,
 * `font-stack-unresolved-throws` — pass an explicit resolver.
 */
export function normalizeOne(
  el: RawElement,
  options: { readonly fontResolver?: FontResolver } = {},
): ViewportIR {
  return normalizeViewport(synthViewport({ children: [el] }), {
    fontResolver: options.fontResolver ?? staticFontResolver(),
  });
}

/**
 * Run a primitive's `RawElement` through normalize + buildDocument.
 */
export function buildOne(
  el: RawElement,
  options: { readonly fontResolver?: FontResolver } = {},
): { readonly context: FigDocumentContext; readonly ir: ViewportIR } {
  const ir = normalizeOne(el, options);
  const built = buildDocument(ir);
  return { context: built.context, ir };
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
 * Walk the Kiwi document and return the first node with the given
 * layer name. Cases reach the synthetic primitive's frame this way
 * because `synthViewport` auto-assigns `<body>` as the outermost
 * layer name.
 */
export function findFigNodeByName(
  context: FigDocumentContext,
  name: string,
): FigNode | undefined {
  function walk(nodes: readonly FigNode[]): FigNode | undefined {
    for (const node of nodes) {
      if (node.name === name) {
        return node;
      }
      const hit = walk(context.document.childrenOf(node));
      if (hit) {
        return hit;
      }
    }
    return undefined;
  }
  return walk(context.document.roots);
}
