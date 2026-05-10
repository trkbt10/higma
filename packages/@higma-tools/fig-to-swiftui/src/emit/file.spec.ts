/**
 * @file Spec for the per-frame Swift file emitter.
 */
import type { FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import { buildFrameTarget, emitFrameFile } from "./file";

function enumName<T extends string>(name: T): KiwiEnumValue<T> {
  return { value: 0, name } as KiwiEnumValue<T>;
}

function frame(name: string, partial: Partial<FigNode> = {}): FigNode {
  return {
    guid: { sessionID: 1, localID: 1 },
    phase: enumName("CREATED"),
    type: enumName("FRAME"),
    name,
    ...partial,
  } as FigNode;
}

describe("buildFrameTarget", () => {
  it("derives PascalCase struct name and kebab-case slug", () => {
    const node = frame("Home Page");
    const target = buildFrameTarget(node, {
      outputDir: "Pages",
      structNamesUsed: new Set(),
      slugsUsed: new Set(),
    });
    expect(target.structName).toBe("HomePage");
    expect(target.slug).toBe("home-page");
    expect(target.filePath).toBe("Pages/HomePage.swift");
  });

  it("dedupes duplicate names with numeric suffixes", () => {
    const a = frame("Home");
    const b = frame("Home");
    const structNamesUsed = new Set<string>();
    const slugsUsed = new Set<string>();
    const targetA = buildFrameTarget(a, { outputDir: "Pages", structNamesUsed, slugsUsed });
    const targetB = buildFrameTarget(b, { outputDir: "Pages", structNamesUsed, slugsUsed });
    expect(targetA.structName).toBe("Home");
    expect(targetB.structName).toBe("Home2");
  });
});

describe("emitFrameFile", () => {
  it("wraps the SwiftUI body in a `View` struct and #Preview macro", () => {
    const node = frame("Hello", {
      stackMode: enumName("VERTICAL"),
      stackSpacing: 4,
      children: [
        {
          guid: { sessionID: 1, localID: 2 },
          phase: enumName("CREATED"),
          type: enumName("TEXT"),
          characters: "Hello",
          fontSize: 16,
          fontName: { family: "Inter", style: "Regular" },
        } as FigNode,
      ],
    });
    const target = buildFrameTarget(node, {
      outputDir: "Pages",
      structNamesUsed: new Set(),
      slugsUsed: new Set(),
    });
    const file = emitFrameFile(target);
    expect(file.path).toBe("Pages/Hello.swift");
    expect(file.contents).toBe(
      [
        "import SwiftUI",
        "",
        "struct Hello: View {",
        "  var body: some View {",
        "    VStack(alignment: .leading, spacing: 4) {",
        '      Text("Hello")',
        "        .font(.system(size: 16, weight: .regular))",
        "    }",
        "      .clipShape(Rectangle())",
        "  }",
        "}",
        "",
        "#Preview {",
        "  Hello()",
        "}",
        "",
      ].join("\n"),
    );
  });
});
