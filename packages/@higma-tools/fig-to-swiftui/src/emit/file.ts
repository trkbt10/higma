/**
 * @file Generate a complete `.swift` file from a Figma frame.
 *
 * The file shape:
 *
 *   import SwiftUI
 *
 *   struct <ComponentName>: View {
 *     var body: some View {
 *       <SwiftUI tree>
 *     }
 *   }
 *
 *   #Preview { <ComponentName>() }
 *
 * `#Preview` is the modern SwiftUI macro replacing `PreviewProvider`;
 * it is supported on Xcode 15+ which is the current Apple-published
 * minimum for SwiftUI development.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { toCssSlug, toPascalCase, uniqueId, uniqueIdent } from "@higma-primitives/identifier";
import { emitRootFrame, type EmitContext } from "./walk";
import { serialize, type Modifier, type SwiftView } from "../swift-tree";

/** A single Swift source file produced by the emitter. */
export type SwiftFile = {
  /** Output-root-relative path (e.g. `Pages/Home.swift`). */
  readonly path: string;
  /** File contents — generated Swift source. */
  readonly contents: string;
};

/** A target frame discovered under the chosen CANVAS. */
export type FrameTarget = {
  readonly node: FigNode;
  /** PascalCase Swift struct identifier. */
  readonly structName: string;
  /** Output-root-relative file path. */
  readonly filePath: string;
  /** kebab-case slug used in the file path. */
  readonly slug: string;
};

const INDENT = "  ";

/**
 * Build the structural target descriptor for a single frame: a Swift
 * struct name and a `.swift` filename. Names collide between frames
 * with the same Figma name, so the caller passes mutable `Set`s to
 * dedupe across the whole emit run.
 */
export function buildFrameTarget(
  node: FigNode,
  options: {
    readonly outputDir: string;
    readonly structNamesUsed: Set<string>;
    readonly slugsUsed: Set<string>;
  },
): FrameTarget {
  const baseSlug = toCssSlug(node.name ?? "frame");
  const slug = uniqueId(baseSlug, options.slugsUsed);
  const baseStruct = toPascalCase(node.name ?? "Frame");
  const structName = uniqueIdent(baseStruct, options.structNamesUsed);
  const filePath = `${options.outputDir}/${structName}.swift`;
  return { node, structName, filePath, slug };
}

/**
 * Threshold above which a stack's children are extracted into
 * `private var cN: some View { ... }` properties on the struct.
 * SwiftUI's `@ViewBuilder` is implemented as a chain of generic
 * `buildBlock` overloads up to 10 children; bodies with more
 * children fall back to `TupleView` builders that the type-checker
 * inflates exponentially during inference. Splitting children
 * into individual computed properties — each bound to a single
 * `some View` opaque type — keeps every `body` under the 10-child
 * happy-path AND breaks the inference chain into linear pieces.
 *
 * 8 leaves room for SwiftUI's own builder overloads (the body
 * still inserts a few wrappers above the children) without
 * crossing the type-check cliff. The actual cliff for nested
 * Path bodies is around the ~12 mark in practice; 8 is a
 * safety margin.
 */
const SPLIT_BODY_CHILD_THRESHOLD = 8;

type StackView = Extract<SwiftView, { kind: "stack" }>;

/**
 * If the root view is a stack with many children, split each
 * child into a `private var c<i>: some View { ... }` property and
 * rebuild the body to reference those properties. Returns
 * `undefined` when the tree doesn't need splitting.
 */
function splitLargeBody(
  tree: SwiftView,
): { readonly properties: readonly string[]; readonly body: string } | undefined {
  if (tree.kind !== "stack") {
    return undefined;
  }
  const children = tree.children;
  if (children.length <= SPLIT_BODY_CHILD_THRESHOLD) {
    return undefined;
  }
  const properties: string[] = [];
  const propertyRefs: string[] = [];
  children.forEach((child, i) => {
    const propName = `c${i}`;
    propertyRefs.push(propName);
    const childSrc = serialize(child, 2);
    properties.push(
      [
        `${INDENT}@ViewBuilder`,
        `${INDENT}private var ${propName}: some View {`,
        `${INDENT}${INDENT}${childSrc}`,
        `${INDENT}}`,
      ].join("\n"),
    );
  });
  const stackHead = renderStackHead(tree);
  const propIndent = `${INDENT}${INDENT}${INDENT}`;
  // SwiftUI's `@ViewBuilder` exposes `buildBlock` overloads up to
  // 10 children; bodies with more children fail to compile with
  // "type ... has no member 'buildBlock'" or fall back to a
  // `TupleView` builder whose type-check time blows up. We wrap
  // groups of 10 children inside `Group { ... }` to keep the
  // outer stack's child-count below the threshold; `Group` is a
  // transparent passthrough container so this doesn't change the
  // rendered output.
  const groupedRefs = chunkIntoGroups(propertyRefs);
  const bodyLines = [
    `${INDENT}${INDENT}${stackHead} {`,
    ...groupedRefs.flatMap((entry) => {
      if (entry.kind === "leaf") {
        return [`${propIndent}${entry.ref}`];
      }
      return [
        `${propIndent}Group {`,
        ...entry.refs.map((r) => `${propIndent}${INDENT}${r}`),
        `${propIndent}}`,
      ];
    }),
    `${INDENT}${INDENT}}${renderModifiers(tree.modifiers, 2)}`,
  ];
  return { properties, body: bodyLines.join("\n") };
}

type ChildEntry =
  | { readonly kind: "leaf"; readonly ref: string }
  | { readonly kind: "group"; readonly refs: readonly string[] };

/**
 * Chunk a flat list of child references into groups so that the
 * outer stack contains at most `MAX_DIRECT_CHILDREN` children. Each
 * group of consecutive children is wrapped in a SwiftUI `Group`
 * container which itself counts as one child of the outer stack.
 */
const MAX_DIRECT_CHILDREN = 10;
const GROUP_SIZE = 10;

function chunkIntoGroups(refs: readonly string[]): readonly ChildEntry[] {
  if (refs.length <= MAX_DIRECT_CHILDREN) {
    return refs.map((ref) => ({ kind: "leaf", ref }));
  }
  const out: ChildEntry[] = [];
  for (let i = 0; i < refs.length; i += GROUP_SIZE) {
    const slice = refs.slice(i, i + GROUP_SIZE);
    out.push({ kind: "group", refs: slice });
  }
  return out;
}

/** Reconstruct the stack's `HStack(alignment:, spacing:)` opener. */
function renderStackHead(tree: StackView): string {
  const args: string[] = [];
  if (tree.alignment !== undefined) {
    args.push(`alignment: .${tree.alignment}`);
  }
  if (tree.spacing !== undefined && tree.stack !== "ZStack") {
    args.push(`spacing: ${formatNumber(tree.spacing)}`);
  }
  return args.length === 0 ? tree.stack : `${tree.stack}(${args.join(", ")})`;
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

function renderModifiers(mods: readonly Modifier[], depth: number): string {
  if (mods.length === 0) {
    return "";
  }
  // Hack: round-trip the modifier list through `serialize` by
  // wrapping it on an empty `ZStack` and stripping the `ZStack { }`
  // prefix. The serialiser already knows how to format modifier
  // chains; reusing it here keeps indentation rules consistent
  // without exposing the modifier-printing internals.
  const fakeStack: StackView = {
    kind: "stack",
    stack: "ZStack",
    children: [],
    modifiers: mods,
  };
  const rendered = serialize(fakeStack, depth);
  const idx = rendered.indexOf("}");
  return idx >= 0 ? rendered.slice(idx + 1) : "";
}

/** Render a complete Swift file for a frame target. */
/**
 * `fileprivate` helper that decodes a base64 PNG/JPEG into a
 * SwiftUI `Image` — only emitted when the body actually uses it,
 * so files without IMAGE paints stay free of CoreGraphics imports.
 *
 * `fileprivate` keeps each file's copy isolated; without it,
 * compiling N image-bearing files in one module re-declares the
 * helper N times.
 *
 * The helper is only generated when `EmitContext.imageEmbedding`
 * is `"inline"` (the visual-roundtrip spec path). The default
 * `"bundle"` mode emits `Image("<slug>", bundle: .module)`
 * directly and doesn't need a decoder helper.
 */
const INLINE_IMAGE_HELPER = `fileprivate func makeFigToSwiftuiImage(data: Data?, options: Data.Base64DecodingOptions = []) -> Image {
${INDENT}guard let data = data,
${INDENT}      let src  = CGImageSourceCreateWithData(data as CFData, nil),
${INDENT}      let cg   = CGImageSourceCreateImageAtIndex(src, 0, nil)
${INDENT}else { return Image(systemName: "questionmark.square") }
${INDENT}return Image(decorative: cg, scale: 1.0)
}`;

/**
 * Render a complete Swift file for one fig frame target.
 *
 * Wraps `emitRootFrame` output in `import SwiftUI` + `struct Name:
 * View {}` + `#Preview {}`. When the body is large, the children
 * are split into `private var cN: some View` properties to keep
 * SwiftUI's body type-checker tractable. When IMAGE paints are
 * embedded inline (spec-harness mode), the file also includes
 * `CoreGraphics` / `ImageIO` imports + the base64 decoder helper.
 */
export function emitFrameFile(target: FrameTarget, ctx: EmitContext = {}): SwiftFile {
  const tree = emitRootFrame(target.node, ctx);
  const split = splitLargeBody(tree);
  const body = split ? split.body : `${INDENT}${INDENT}${serialize(tree, 2)}`;
  const propertyBlock = split ? split.properties.join("\n\n") : "";
  // The inline-image path needs CoreGraphics + ImageIO for the
  // base64 → CGImage decoder helper. The bundle-resource path
  // doesn't (SwiftUI's `Image(_:bundle:)` is purely SwiftUI).
  const usesInlineImage = body.includes("makeFigToSwiftuiImage");
  const lines = [
    "import SwiftUI",
    ...(usesInlineImage ? ["import CoreGraphics", "import ImageIO"] : []),
    "",
    ...(usesInlineImage ? [INLINE_IMAGE_HELPER, ""] : []),
    `struct ${target.structName}: View {`,
    ...(propertyBlock ? [propertyBlock, ""] : []),
    `${INDENT}var body: some View {`,
    body,
    `${INDENT}}`,
    "}",
    "",
    `#Preview {`,
    `${INDENT}${target.structName}()`,
    "}",
    "",
  ];
  return { path: target.filePath, contents: lines.join("\n") };
}
