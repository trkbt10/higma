/**
 * @file Spec for the per-frame Godot scene file builder.
 */
import type { FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import { buildFrameTarget, emitFrameFile } from "./file";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function fixtureChildrenOf(node: FigNode): readonly FigNode[] {
  const children: FigNode[] = [];
  for (const child of node.children ?? []) {
    if (child === undefined || child === null) {
      throw new Error("fixtureChildrenOf: fixture contains an empty child slot");
    }
    children.push(child);
  }
  return children;
}

function frame(partial: Partial<FigNode>): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("FRAME"),
    ...partial,
  } as FigNode;
}

describe("buildFrameTarget", () => {
  it("derives a PascalCase scene name and a Pages/<name>.tscn path", () => {
    const target = buildFrameTarget(frame({ name: "Home Page" }), {
      outputDir: "Pages",
      sceneNamesUsed: new Set(),
      slugsUsed: new Set(),
    });
    expect(target.sceneName).toBe("HomePage");
    expect(target.filePath).toBe("Pages/HomePage.tscn");
    expect(target.slug).toBe("home-page");
  });

  it("dedupes scene names across multiple frames with the same Figma name", () => {
    const used = new Set<string>();
    const slugs = new Set<string>();
    const a = buildFrameTarget(frame({ name: "Home" }), {
      outputDir: "Pages",
      sceneNamesUsed: used,
      slugsUsed: slugs,
    });
    const b = buildFrameTarget(frame({ name: "Home" }), {
      outputDir: "Pages",
      sceneNamesUsed: used,
      slugsUsed: slugs,
    });
    expect(a.sceneName).toBe("Home");
    expect(b.sceneName).not.toBe("Home");
    expect(a.filePath).not.toBe(b.filePath);
  });
});

describe("emitFrameFile", () => {
  it("renames the root node to the scene-target name", () => {
    const target = buildFrameTarget(
      frame({ name: "Home Page", size: { x: 320, y: 480 } }),
      {
        outputDir: "Pages",
        sceneNamesUsed: new Set(),
        slugsUsed: new Set(),
      },
    );
    const file = emitFrameFile(target, { childrenOf: fixtureChildrenOf });
    expect(file.path).toBe("Pages/HomePage.tscn");
    expect(file.contents).toContain('[node name="HomePage" type="Control"]');
    expect(file.contents).toContain("offset_right = 320.0");
    expect(file.contents).toContain("offset_bottom = 480.0");
  });
});
