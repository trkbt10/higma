/**
 * @file Drive emission for a chosen set of target frames.
 *
 * The orchestrator returns the in-memory file set without touching
 * disk; the caller (CLI runtime or programmatic consumer) decides
 * where to write. Output paths are relative to the emit root and use
 * a single `Pages/<SceneName>.tscn` layout — symmetric with the
 * SwiftUI peer's `Pages/<StructName>.swift` layout.
 *
 * When `sharedTheme` is enabled (opt-in via `--shared-theme`), the
 * orchestrator runs a cross-scene dedup pass on the typed IR before
 * serialization: StyleBoxFlat sub-resources that appear identically in
 * two or more scenes are hoisted into a single `Themes/<name>.tres`
 * file and referenced via `ExtResource`. Default behaviour is
 * unchanged — every scene stays self-contained.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { serializeResource, serializeScene } from "../godot-tree";
import { buildFrameScene, buildFrameTarget, type FrameTarget, type GodotFile } from "./file";
import { extractSharedTheme } from "./shared-theme";
import type { EmitContext } from "./walk";

const PAGES_DIR = "Pages";
const DEFAULT_THEME_NAME = "Default";

export type EmitOptions = {
  /**
   * When true, hoist StyleBoxFlat sub-resources shared across two or
   * more scenes into a single `Themes/<themeName>.tres` Theme. Default
   * `false` — every scene stays self-contained.
   */
  readonly sharedTheme?: boolean;
  /** Name of the Theme `.tres` file (no extension). Default `"Default"`. */
  readonly themeName?: string;
  /**
   * Doc-level resolver passed to the walker. Carries the canonical
   * SymbolResolver for INSTANCE → SYMBOL resolution. Required for any
   * fixture that references components defined on another canvas.
   */
  readonly emit?: EmitContext;
};

export type EmitResult = {
  readonly files: readonly GodotFile[];
  readonly targets: readonly FrameTarget[];
};

/**
 * Drive the full emission for a fixed set of target frames.
 *
 * The function is synchronous because the Godot emit walks the
 * pre-resolved FigNode tree directly — no font / image decode, no
 * SVG flattening, no preview bundling. Same design departure from
 * fig-to-web that fig-to-swiftui makes: Godot consumes engine-bundled
 * fonts and resources, so the emitter can stop at the source-text
 * boundary.
 */
export function emitFromFrames(
  frames: readonly FigNode[],
  options: EmitOptions = {},
): EmitResult {
  const sceneNamesUsed = new Set<string>();
  const slugsUsed = new Set<string>();
  const targets: FrameTarget[] = [];
  const builtScenes: ReturnType<typeof buildFrameScene>[] = [];
  const emit = options.emit ?? {};
  for (const node of frames) {
    const target = buildFrameTarget(node, {
      outputDir: PAGES_DIR,
      sceneNamesUsed,
      slugsUsed,
    });
    targets.push(target);
    builtScenes.push(buildFrameScene(target, emit));
  }
  if (options.sharedTheme !== true) {
    const files = builtScenes.map((sceneDoc, idx) => ({
      path: targets[idx]!.filePath,
      contents: serializeScene(sceneDoc),
    }));
    return { files, targets };
  }
  const themeName = options.themeName ?? DEFAULT_THEME_NAME;
  const extraction = extractSharedTheme(builtScenes, themeName);
  const files: GodotFile[] = extraction.scenes.map((sceneDoc, idx) => ({
    path: targets[idx]!.filePath,
    contents: serializeScene(sceneDoc),
  }));
  if (extraction.theme) {
    files.push({
      path: extraction.theme.path,
      contents: serializeResource(extraction.theme.resource),
    });
  }
  return { files, targets };
}
