/**
 * @file Spec for the cross-scene Theme `.tres` extraction.
 *
 * Verifies the three behaviours that matter for `--shared-theme`:
 *
 *   1. Identical StyleBoxes across scenes get hoisted into one Theme.
 *   2. Scenes that lose a StyleBox keep an `ExtResource` reference.
 *   3. StyleBoxes unique to a single scene stay inlined.
 */
import {
  colorVal,
  intVal,
  node,
  property,
  scene,
  subResource,
  type GodotScene,
} from "../godot-tree";
import { extractSharedTheme } from "./shared-theme";

function panelScene(name: string, sub: ReturnType<typeof subResource>): GodotScene {
  return scene(
    node(name, "Panel", {
      properties: [property("theme_override_styles/panel", { kind: "sub-resource", id: sub.id })],
    }),
    { subResources: [sub] },
  );
}

describe("extractSharedTheme", () => {
  it("returns scenes unchanged when no StyleBox is shared", () => {
    const sceneA = panelScene(
      "A",
      subResource("StyleBoxFlat_001", "StyleBoxFlat", [
        property("bg_color", colorVal(1, 0, 0, 1)),
      ]),
    );
    const sceneB = panelScene(
      "B",
      subResource("StyleBoxFlat_002", "StyleBoxFlat", [
        property("bg_color", colorVal(0, 1, 0, 1)),
      ]),
    );
    const result = extractSharedTheme([sceneA, sceneB], "Default");
    expect(result.theme).toBeUndefined();
    expect(result.scenes).toEqual([sceneA, sceneB]);
  });

  it("hoists a StyleBox shared across two scenes into a Theme", () => {
    const sharedProps = [property("bg_color", colorVal(0.9, 0.9, 0.9, 1))];
    const sceneA = panelScene("A", subResource("StyleBoxFlat_001", "StyleBoxFlat", sharedProps));
    const sceneB = panelScene("B", subResource("StyleBoxFlat_001", "StyleBoxFlat", sharedProps));
    const result = extractSharedTheme([sceneA, sceneB], "Default");
    expect(result.theme).toBeDefined();
    expect(result.theme?.path).toBe("Themes/Default.tres");
    expect(result.theme?.resource.subResources).toHaveLength(1);
    for (const sceneDoc of result.scenes) {
      expect(sceneDoc.subResources).toHaveLength(0);
      expect(sceneDoc.extResources.some((ext) => ext.type === "Theme")).toBe(true);
      expect(sceneDoc.extResources.some((ext) => ext.type === "StyleBoxFlat")).toBe(true);
    }
  });

  it("rewrites the panel reference from SubResource to ExtResource on each scene", () => {
    const sharedProps = [property("bg_color", colorVal(0.5, 0.5, 0.5, 1))];
    const sceneA = panelScene("A", subResource("StyleBoxFlat_001", "StyleBoxFlat", sharedProps));
    const sceneB = panelScene("B", subResource("StyleBoxFlat_001", "StyleBoxFlat", sharedProps));
    const result = extractSharedTheme([sceneA, sceneB], "Default");
    for (const sceneDoc of result.scenes) {
      const panelStyle = sceneDoc.root.properties.find((p) => p.name === "theme_override_styles/panel");
      expect(panelStyle?.value.kind).toBe("ext-resource");
    }
  });

  it("attaches a `theme = ExtResource(...)` property to each scene root", () => {
    const sharedProps = [property("corner_radius_top_left", intVal(8))];
    const sceneA = panelScene("A", subResource("StyleBoxFlat_001", "StyleBoxFlat", sharedProps));
    const sceneB = panelScene("B", subResource("StyleBoxFlat_001", "StyleBoxFlat", sharedProps));
    const result = extractSharedTheme([sceneA, sceneB], "Default");
    for (const sceneDoc of result.scenes) {
      const themeProp = sceneDoc.root.properties.find((p) => p.name === "theme");
      expect(themeProp?.value).toEqual({ kind: "ext-resource", id: "1_theme" });
    }
  });

  it("keeps StyleBoxes unique to a single scene inlined", () => {
    const sharedProps = [property("bg_color", colorVal(0.5, 0.5, 0.5, 1))];
    const uniqueProps = [property("bg_color", colorVal(1, 0, 1, 1))];
    const shared = subResource("StyleBoxFlat_001", "StyleBoxFlat", sharedProps);
    const unique = subResource("StyleBoxFlat_002", "StyleBoxFlat", uniqueProps);
    const sceneA = scene(
      node("A", "Control", {
        children: [
          node("Bg", "Panel", {
            properties: [
              property("theme_override_styles/panel", { kind: "sub-resource", id: shared.id }),
            ],
          }),
          node("Accent", "Panel", {
            properties: [
              property("theme_override_styles/panel", { kind: "sub-resource", id: unique.id }),
            ],
          }),
        ],
      }),
      { subResources: [shared, unique] },
    );
    const sceneB = panelScene("B", shared);
    const result = extractSharedTheme([sceneA, sceneB], "Default");
    expect(result.theme).toBeDefined();
    // Scene A keeps the unique StyleBox as a sub-resource…
    expect(result.scenes[0]?.subResources).toHaveLength(1);
    expect(result.scenes[0]?.subResources[0]?.id).toBe("StyleBoxFlat_002");
    // …and Scene B has zero sub-resources because its only StyleBox was shared.
    expect(result.scenes[1]?.subResources).toHaveLength(0);
  });
});
