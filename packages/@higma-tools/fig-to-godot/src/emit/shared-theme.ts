/**
 * @file Cross-scene Theme `.tres` extraction.
 *
 * The walker produces one `StyleBoxFlat` sub-resource per Figma
 * fill/corner/stroke/shadow combination, inlined into each scene's
 * `[sub_resource]` block. When the same combination appears across
 * multiple scenes (e.g. every Card frame uses the same surface fill +
 * 8px corner radius), the inline copies bloat the `.tscn` files and
 * make a Theme tweak require editing N scenes.
 *
 * `extractSharedTheme` solves that by:
 *
 *   1. Hashing every StyleBoxFlat sub-resource by its property list
 *      (the same shape the serializer would print).
 *   2. Promoting each StyleBox that appears in ≥ 2 scenes into a
 *      single `<Canvas>.tres` Theme resource.
 *   3. Replacing each scene's inline copy with an `ExtResource(...)`
 *      reference + `[ext_resource type="StyleBoxFlat" path="..."]`
 *      declaration.
 *
 * StyleBoxes that are unique to a single scene stay inlined — the
 * Theme is for *shared* values, not every value.
 *
 * The extractor operates on the typed IR before serialization. It is
 * opt-in (drive via `--shared-theme`); the default emit path leaves
 * scenes self-contained.
 */
import type {
  GodotExtResource,
  GodotProperty,
  GodotResource,
  GodotScene,
  GodotSubResource,
  GodotValue,
} from "../godot-tree";

export type SharedThemeFile = {
  /** Output-root-relative path, e.g. `Themes/Default.tres`. */
  readonly path: string;
  /** The Theme resource IR — caller serializes via `serializeResource`. */
  readonly resource: GodotResource;
};

export type SharedThemeResult = {
  /** The rewritten scenes (always the same length as `scenes` input). */
  readonly scenes: readonly GodotScene[];
  /** The Theme `.tres` file, or `undefined` when no StyleBox is shared. */
  readonly theme?: SharedThemeFile;
};

/**
 * Hoist StyleBoxFlat sub-resources that appear identically across two
 * or more scenes into a shared Theme resource. Scenes are returned
 * with the duplicated sub-resources removed and replaced by
 * ExtResource references.
 *
 * `themeName` controls the Theme file name (`Themes/<themeName>.tres`)
 * and the `res://` path scenes use to reference it. Pass the canvas
 * name (typically `"Default"` or the page name).
 *
 * `themePath` is the literal path scenes reference via
 * `[ext_resource path=...]`. Defaults to `res://Themes/<themeName>.tres`
 * — the standard Godot 4.x project-root scheme.
 */
export function extractSharedTheme(
  scenes: readonly GodotScene[],
  themeName: string,
  themePath: string = `res://Themes/${themeName}.tres`,
): SharedThemeResult {
  const fingerprintsByScene = scenes.map((sceneDoc) => fingerprintSubResources(sceneDoc.subResources));
  const sharedFingerprints = pickSharedFingerprints(fingerprintsByScene);
  if (sharedFingerprints.size === 0) {
    return { scenes };
  }
  const sharedSubResources = collectSharedSubResources(scenes, sharedFingerprints, fingerprintsByScene);
  const themeResource = buildThemeResource(sharedSubResources);
  const themeFile: SharedThemeFile = {
    path: `Themes/${themeName}.tres`,
    resource: themeResource,
  };
  const rewrittenScenes = scenes.map((sceneDoc, idx) =>
    rewriteSceneWithExtResources(
      sceneDoc,
      fingerprintsByScene[idx]!,
      sharedFingerprints,
      themePath,
    ),
  );
  return { scenes: rewrittenScenes, theme: themeFile };
}

/** Map of `subResourceId → fingerprint` for one scene. */
type FingerprintMap = ReadonlyMap<string, string>;

function fingerprintSubResources(subs: readonly GodotSubResource[]): FingerprintMap {
  const out = new Map<string, string>();
  for (const sub of subs) {
    out.set(sub.id, fingerprintSubResource(sub));
  }
  return out;
}

/**
 * Build a stable string fingerprint for a sub-resource. Includes the
 * type (so a StyleBoxFlat with the same body as a StyleBoxLine never
 * collides) and every property in declared order. Property order
 * matters because Godot reads the `.tscn` line-by-line and the
 * builders we have today emit a deterministic order — relying on that
 * is fine. If a future builder reorders properties, the fingerprint
 * function should be updated to sort by `name` first.
 */
function fingerprintSubResource(sub: GodotSubResource): string {
  const parts: string[] = [`type=${sub.type}`];
  for (const prop of sub.properties) {
    parts.push(`${prop.name}=${fingerprintValue(prop.value)}`);
  }
  return parts.join("\n");
}

function fingerprintValue(value: GodotValue): string {
  switch (value.kind) {
    case "int":
      return `int:${value.value}`;
    case "float":
      return `float:${value.value}`;
    case "bool":
      return `bool:${value.value ? "1" : "0"}`;
    case "string":
      return `string:${value.value}`;
    case "vector2":
      return `vector2:${value.x},${value.y}`;
    case "rect2":
      return `rect2:${value.x},${value.y},${value.w},${value.h}`;
    case "color":
      return `color:${value.r},${value.g},${value.b},${value.a}`;
    case "node-path":
      return `node-path:${value.path}`;
    case "ext-resource":
      return `ext-resource:${value.id}`;
    case "sub-resource":
      return `sub-resource:${value.id}`;
    case "enum":
      return `enum:${value.value}`;
    case "raw":
      return `raw:${value.text}`;
  }
}

/**
 * Collect every fingerprint that appears in at least 2 scenes. Counts
 * per scene, not per occurrence within a scene — the same StyleBox
 * used twice in a single scene is not "shared" yet.
 */
function pickSharedFingerprints(perScene: readonly FingerprintMap[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const map of perScene) {
    const seen = new Set<string>();
    for (const fp of map.values()) {
      if (seen.has(fp)) {
        continue;
      }
      seen.add(fp);
      counts.set(fp, (counts.get(fp) ?? 0) + 1);
    }
  }
  const out = new Set<string>();
  for (const [fp, count] of counts) {
    if (count >= 2) {
      out.add(fp);
    }
  }
  return out;
}

/**
 * Pick one canonical sub-resource per shared fingerprint. The
 * canonical form keeps the first occurrence's body but renames the
 * id to a Theme-scoped form (`Theme_<n>`) so the Theme file owns the
 * sub-resource id space distinct from any scene's own pool.
 */
function collectSharedSubResources(
  scenes: readonly GodotScene[],
  shared: ReadonlySet<string>,
  fingerprintsByScene: readonly FingerprintMap[],
): readonly { readonly fingerprint: string; readonly sub: GodotSubResource; readonly themeId: string }[] {
  const firstOccurrenceByFingerprint = new Map<string, GodotSubResource>();
  for (let i = 0; i < scenes.length; i += 1) {
    const sceneDoc = scenes[i]!;
    const fpMap = fingerprintsByScene[i]!;
    for (const sub of sceneDoc.subResources) {
      const fp = fpMap.get(sub.id)!;
      if (!shared.has(fp) || firstOccurrenceByFingerprint.has(fp)) {
        continue;
      }
      firstOccurrenceByFingerprint.set(fp, sub);
    }
  }
  return Array.from(firstOccurrenceByFingerprint.entries()).map(([fingerprint, sub], idx) => {
    const themeId = formatThemeId(sub.type, idx + 1);
    return { fingerprint, sub: { ...sub, id: themeId }, themeId };
  });
}

function formatThemeId(type: string, counter: number): string {
  return `${type}_${counter.toString().padStart(3, "0")}`;
}

/**
 * Build the Theme resource. Each shared StyleBoxFlat becomes a
 * sub-resource of the Theme, indexed by the Theme's own
 * `Panel/styles/<n>` property. Scenes reference the StyleBox via
 * `ExtResource` rather than `SubResource` because the StyleBoxes now
 * live in another file.
 *
 * v0 simplification: every shared StyleBox is exposed under
 * `Panel/styles/panel_<n>`. A future iteration could group by Control
 * type (Panel, Button, Label) to match Godot's conventional Theme
 * structure, but the current node walk only assigns StyleBoxes to
 * Panels so the conservative `Panel/styles/...` namespace is correct.
 */
function buildThemeResource(
  sharedSubs: readonly { readonly sub: GodotSubResource; readonly themeId: string }[],
): GodotResource {
  const subResources: GodotSubResource[] = sharedSubs.map((entry) => entry.sub);
  const properties: GodotProperty[] = sharedSubs.map((entry, idx) => ({
    name: `Panel/styles/panel_${idx + 1}`,
    value: { kind: "sub-resource", id: entry.themeId },
  }));
  return {
    type: "Theme",
    extResources: [],
    subResources,
    properties,
  };
}

/**
 * Rewrite a single scene to remove its now-shared StyleBoxes and
 * replace inline `SubResource(...)` references with `ExtResource(...)`
 * pointing at the Theme.
 *
 * The Theme itself is referenced via a single `[ext_resource]` entry
 * with id `<sceneSlug>_theme` — Godot uses string ids here so we
 * derive a stable slug from the scene's root name.
 */
function rewriteSceneWithExtResources(
  sceneDoc: GodotScene,
  fpMap: FingerprintMap,
  shared: ReadonlySet<string>,
  themePath: string,
): GodotScene {
  const sceneShared = listSceneSharedSubs(sceneDoc, fpMap, shared);
  if (sceneShared.length === 0) {
    return sceneDoc;
  }
  const themeExtId = "1_theme";
  const themeExt: GodotExtResource = {
    id: themeExtId,
    type: "Theme",
    path: themePath,
  };
  const styleBoxExts: GodotExtResource[] = sceneShared.map((entry) => ({
    id: `${entry.themeId}_ext`,
    type: entry.sub.type,
    path: `${themePath}::${entry.themeId}`,
  }));
  const oldIdToExtId = new Map<string, string>();
  for (let i = 0; i < sceneShared.length; i += 1) {
    oldIdToExtId.set(sceneShared[i]!.oldId, styleBoxExts[i]!.id);
  }
  const remainingSubResources = sceneDoc.subResources.filter(
    (sub) => !oldIdToExtId.has(sub.id),
  );
  const rewrittenRoot = rewriteNodeReferences(sceneDoc.root, oldIdToExtId, themeExtId);
  return {
    extResources: [themeExt, ...styleBoxExts],
    subResources: remainingSubResources,
    root: rewrittenRoot,
  };
}

/** List the shared sub-resources actually present in this scene. */
function listSceneSharedSubs(
  sceneDoc: GodotScene,
  fpMap: FingerprintMap,
  shared: ReadonlySet<string>,
): readonly { readonly oldId: string; readonly themeId: string; readonly sub: GodotSubResource }[] {
  const present = sceneDoc.subResources.filter((sub) => {
    const fp = fpMap.get(sub.id);
    return fp !== undefined && shared.has(fp);
  });
  return present.map((sub, idx) => ({
    oldId: sub.id,
    themeId: formatThemeId(sub.type, idx + 1),
    sub,
  }));
}

/** Recursively rewrite SubResource(oldId) → ExtResource(extId) and attach `theme = ExtResource(themeExtId)` to the root. */
function rewriteNodeReferences(
  node: GodotScene["root"],
  oldIdToExtId: ReadonlyMap<string, string>,
  themeExtId: string,
  isRoot: boolean = true,
): GodotScene["root"] {
  const properties = node.properties.map((prop) => rewriteProperty(prop, oldIdToExtId));
  const themedProperties = isRoot ? attachTheme(properties, themeExtId) : properties;
  const children = node.children.map((child) =>
    rewriteNodeReferences(child, oldIdToExtId, themeExtId, false),
  );
  return { ...node, properties: themedProperties, children };
}

function rewriteProperty(
  prop: GodotProperty,
  oldIdToExtId: ReadonlyMap<string, string>,
): GodotProperty {
  if (prop.value.kind !== "sub-resource") {
    return prop;
  }
  const extId = oldIdToExtId.get(prop.value.id);
  if (!extId) {
    return prop;
  }
  return { name: prop.name, value: { kind: "ext-resource", id: extId } };
}

/**
 * Append a `theme = ExtResource("<id>")` property to the root if it
 * does not already carry a `theme` property. Without this the Theme
 * resource would be referenced as ExtResource but never applied;
 * Godot only walks `theme` for inheritance.
 */
function attachTheme(properties: readonly GodotProperty[], themeExtId: string): readonly GodotProperty[] {
  if (properties.some((p) => p.name === "theme")) {
    return properties;
  }
  return [...properties, { name: "theme", value: { kind: "ext-resource", id: themeExtId } }];
}
