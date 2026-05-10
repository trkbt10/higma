/**
 * @file Drive emission for a chosen set of target frames.
 *
 * The orchestrator returns the in-memory file set without touching
 * disk; the caller (CLI runtime or programmatic consumer) decides
 * where to write. Output paths are relative to the emit root and use
 * a single `Pages/<StructName>.swift` layout — tighter than fig-to-web's
 * canvas-aware folder layout because the v0 SwiftUI emit doesn't yet
 * compose multiple canvases or reusable components.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { buildFrameTarget, emitFrameFile, type FrameTarget, type SwiftFile } from "./file";
import type { EmitContext } from "./walk";

const PAGES_DIR = "Pages";

export type EmitResult = {
  readonly files: readonly SwiftFile[];
  readonly targets: readonly FrameTarget[];
};

/**
 * Drive the full emission for a fixed set of target frames.
 *
 * The function is synchronous because the SwiftUI emit walks the
 * pre-resolved FigNode tree directly — no font / image decode, no
 * SVG flattening, no preview bundling. That's the design departure
 * from fig-to-web: SwiftUI consumes Apple-bundled fonts and asset
 * catalogs, so the emitter can stop at the source-text boundary.
 */
export function emitFromFrames(frames: readonly FigNode[], ctx: EmitContext = {}): EmitResult {
  const structNamesUsed = new Set<string>();
  const slugsUsed = new Set<string>();
  const targets: FrameTarget[] = [];
  const files: SwiftFile[] = [];
  for (const node of frames) {
    const target = buildFrameTarget(node, {
      outputDir: PAGES_DIR,
      structNamesUsed,
      slugsUsed,
    });
    targets.push(target);
    files.push(emitFrameFile(target, ctx));
  }
  return { files, targets };
}
