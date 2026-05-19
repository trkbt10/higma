/**
 * @file Spec for the Swift render bridge — pure-TS bits only.
 *
 * `renderSwiftToPng` itself depends on Apple's `swift` CLI and is
 * exercised end-to-end by `spec/cases/<name>/render.spec.ts` (gated by
 * `isSwiftAvailable()`). This spec covers the deterministic routines:
 *
 *   - `stripPreviewMacro` — must drop the `#Preview { ... }` block at
 *     the file tail without touching the user struct.
 *   - `defaultDriverPath` — must point at the shipped Driver.swift so
 *     downstream callers don't have to know the package layout.
 *   - `isSwiftAvailable` — predicate sanity (boolean, never throws).
 */
import { existsSync } from "node:fs";
import {
  defaultDriverPath,
  isSwiftAvailable,
  stripPreviewMacro,
} from "./swift-render";

describe("stripPreviewMacro", () => {
  it("removes a tail #Preview block", () => {
    const source = [
      "import SwiftUI",
      "",
      "struct Button: View {",
      "  var body: some View {",
      "    Text(\"Tap\")",
      "  }",
      "}",
      "",
      "#Preview {",
      "  Button()",
      "}",
      "",
    ].join("\n");
    expect(stripPreviewMacro(source)).toBe(
      [
        "import SwiftUI",
        "",
        "struct Button: View {",
        "  var body: some View {",
        "    Text(\"Tap\")",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("is a no-op when no #Preview is present", () => {
    const source = "import SwiftUI\n\nstruct X: View { var body: some View { Text(\"x\") } }\n";
    expect(stripPreviewMacro(source)).toBe(source);
  });

  it("only strips the first balanced block (multi-line bodies survive)", () => {
    const source = [
      "import SwiftUI",
      "struct X: View { var body: some View { Text(\"x\") } }",
      "#Preview {",
      "  X()",
      "    .padding(8)",
      "}",
      "",
    ].join("\n");
    expect(stripPreviewMacro(source)).toBe(
      [
        "import SwiftUI",
        "struct X: View { var body: some View { Text(\"x\") } }",
        "",
      ].join("\n"),
    );
  });
});

describe("defaultDriverPath", () => {
  it("points at a Driver.swift that exists on disk", () => {
    const path = defaultDriverPath();
    expect(path).toMatch(/Driver\.swift$/u);
    expect(existsSync(path)).toBe(true);
  });
});

describe("isSwiftAvailable", () => {
  it("resolves to a boolean", async () => {
    const result = await isSwiftAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("returns false for a nonexistent binary path", async () => {
    expect(await isSwiftAvailable("/nonexistent/swift")).toBe(false);
  });
});
