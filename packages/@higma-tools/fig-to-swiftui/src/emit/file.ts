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
import { serialize } from "../swift-tree";

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
 * SwiftUI's `Image` lacks a constructor that accepts `Data` directly,
 * so when the emitter references a base64-encoded image (via
 * `firstVisibleImagePaint`) it generates a `makeFigToSwiftuiImage(data:)`
 * call. We inject the matching helper at file scope here so every
 * emitted file is self-contained — no external `+ImageHelpers.swift`
 * for the consumer to include.
 *
 * The helper goes through `CGImageSource` so it stays cross-platform
 * (CoreGraphics + ImageIO are available on iOS / macOS / tvOS /
 * visionOS without AppKit/UIKit). The fallback `systemName:
 * "questionmark.square"` keeps the placeholder visible if the bytes
 * fail to decode rather than silently emitting an empty view.
 */
const IMAGE_HELPER = `func makeFigToSwiftuiImage(data: Data?, options: Data.Base64DecodingOptions = []) -> Image {
${INDENT}guard let data = data,
${INDENT}      let src  = CGImageSourceCreateWithData(data as CFData, nil),
${INDENT}      let cg   = CGImageSourceCreateImageAtIndex(src, 0, nil)
${INDENT}else { return Image(systemName: "questionmark.square") }
${INDENT}return Image(decorative: cg, scale: 1.0)
}`;

/** Render a complete Swift file for a frame target. */
export function emitFrameFile(target: FrameTarget, ctx: EmitContext = {}): SwiftFile {
  const tree = emitRootFrame(target.node, ctx);
  const body = serialize(tree, 2);
  const usesImage = body.includes("makeFigToSwiftuiImage");
  const lines = [
    "import SwiftUI",
    ...(usesImage ? ["import CoreGraphics", "import ImageIO"] : []),
    "",
    ...(usesImage ? [IMAGE_HELPER, ""] : []),
    `struct ${target.structName}: View {`,
    `${INDENT}var body: some View {`,
    `${INDENT}${INDENT}${body}`,
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
