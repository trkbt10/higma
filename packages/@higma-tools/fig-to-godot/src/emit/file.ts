/**
 * @file Generate a complete `.tscn` file from a Figma frame.
 *
 * The file shape (Godot 4.x scene format):
 *
 *   [gd_scene load_steps=N format=3]
 *
 *   [sub_resource type="StyleBoxFlat" id="StyleBoxFlat_001"]
 *   bg_color = Color(0.9, 0.3, 0.3, 1)
 *   ...
 *
 *   [node name="Home" type="Control"]
 *   offset_right = 320
 *   offset_bottom = 480
 *
 *   [node name="Body" type="VBoxContainer" parent="."]
 *   ...
 *
 * One `.tscn` per top-level frame. The output path is
 * `Pages/<NodeName>.tscn` — the same single-folder layout the SwiftUI
 * peer uses, deferring the multi-canvas / reusable-component layout to
 * a v1 follow-up.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { toCssSlug, toPascalCase, uniqueId, uniqueIdent } from "@higma-primitives/identifier";
import {
  floatVal,
  property,
  scene,
  serializeScene,
  type GodotProperty,
  type GodotScene,
} from "../godot-tree";
import { createWalkContext, emitRootFrame, type EmitContext } from "./walk";

/** A single Godot scene file produced by the emitter. */
export type GodotFile = {
  /** Output-root-relative path (e.g. `Pages/Home.tscn`). */
  readonly path: string;
  /** File contents — generated `.tscn` text. */
  readonly contents: string;
  /**
   * Optional binary asset companions the scene references via
   * `[ext_resource]`. Keyed by `res://`-relative path, value is the
   * asset bytes. The render harness writes these next to the scene
   * before invoking Godot. Empty when the scene has no external
   * dependencies.
   */
  readonly assets?: ReadonlyMap<string, Uint8Array>;
};

/** A target frame discovered under the chosen CANVAS. */
export type FrameTarget = {
  readonly node: FigNode;
  /** PascalCase Godot scene root name. */
  readonly sceneName: string;
  /** Output-root-relative file path. */
  readonly filePath: string;
  /** kebab-case slug — reserved for future per-frame asset folders. */
  readonly slug: string;
};

/**
 * Build the structural target descriptor for a single frame: a Godot
 * scene name and a `.tscn` filename. Names collide between frames with
 * the same Figma name, so the caller passes mutable `Set`s to dedupe
 * across the whole emit run.
 */
export function buildFrameTarget(
  node: FigNode,
  options: {
    readonly outputDir: string;
    readonly sceneNamesUsed: Set<string>;
    readonly slugsUsed: Set<string>;
  },
): FrameTarget {
  const baseSlug = toCssSlug(node.name ?? "frame");
  const slug = uniqueId(baseSlug, options.slugsUsed);
  const baseScene = toPascalCase(node.name ?? "Frame");
  const sceneName = uniqueIdent(baseScene, options.sceneNamesUsed);
  const filePath = `${options.outputDir}/${sceneName}.tscn`;
  return { node, sceneName, filePath, slug };
}

/**
 * Build the typed `GodotScene` for a frame target without serializing.
 *
 * Split out from `emitFrameFile` so the orchestrator can run cross-scene
 * passes (e.g. shared-Theme extraction) on the IR before any
 * `.tscn` text is produced.
 *
 * The optional `emit` context carries doc-level lookups (currently the
 * SymbolResolver for INSTANCE → SYMBOL resolution). When omitted, the
 * walker treats INSTANCE nodes as opaque containers whose direct
 * children are the only render source — fine for fixtures without
 * components, lossy for any case that uses them.
 */
export function buildFrameScene(target: FrameTarget, emit: EmitContext = {}): GodotScene {
  const ctx = createWalkContext(emit);
  const inner = emitRootFrame(target.node, ctx);
  // The walker produces a node whose name is derived from the FigNode's
  // own name; rename it to the scene-target's PascalCase scene name so
  // the root node and the scene file share an identity. Carry the
  // walker's own properties (size offsets etc.) and children through.
  const root = {
    ...inner,
    name: target.sceneName,
    properties: ensureRootSizeProperties(target, inner.properties),
  };
  return scene(root, {
    subResources: ctx.subResources,
    extResources: ctx.extResources,
  });
}

/**
 * Variant of `buildFrameScene` that returns the scene IR alongside the
 * binary asset companions the walker accumulated (image bytes
 * referenced by `[ext_resource]` declarations). Callers that need to
 * stage assets onto disk before launching the Godot render use this
 * shape; callers that only need the scene IR can keep using
 * `buildFrameScene`.
 */
export function buildFrameSceneWithAssets(
  target: FrameTarget,
  emit: EmitContext = {},
): { readonly scene: GodotScene; readonly assets: ReadonlyMap<string, Uint8Array> } {
  const ctx = createWalkContext(emit);
  const inner = emitRootFrame(target.node, ctx);
  const root = {
    ...inner,
    name: target.sceneName,
    properties: ensureRootSizeProperties(target, inner.properties),
  };
  return {
    scene: scene(root, {
      subResources: ctx.subResources,
      extResources: ctx.extResources,
    }),
    assets: ctx.imageAssets,
  };
}

/** Render a complete `.tscn` file for a frame target. */
export function emitFrameFile(target: FrameTarget, emit: EmitContext = {}): GodotFile {
  const built = buildFrameSceneWithAssets(target, emit);
  return {
    path: target.filePath,
    contents: serializeScene(built.scene),
    assets: built.assets,
  };
}

/**
 * Make sure the root node carries explicit `offset_right` /
 * `offset_bottom` properties matching the frame's authored size so the
 * editor opens the scene at the right dimensions. The walker already
 * emits these for BoxContainer / Control containers, but a frame whose
 * top-level wrap is a MarginContainer or Panel will not have them on
 * the wrap. We append them when missing rather than overwriting so
 * walker-emitted values win when present.
 */
function ensureRootSizeProperties(
  target: FrameTarget,
  properties: readonly GodotProperty[],
): readonly GodotProperty[] {
  const has = (name: string): boolean => properties.some((p) => p.name === name);
  if (!target.node.size) {
    return properties;
  }
  const out: GodotProperty[] = [...properties];
  if (!has("offset_right")) {
    out.push(property("offset_right", floatVal(target.node.size.x)));
  }
  if (!has("offset_bottom")) {
    out.push(property("offset_bottom", floatVal(target.node.size.y)));
  }
  return out;
}
