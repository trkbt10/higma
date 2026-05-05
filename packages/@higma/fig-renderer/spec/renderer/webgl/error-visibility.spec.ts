/** @file Static checks that WebGL render failures remain observable. */

import fs from "node:fs";
import path from "node:path";

const WEBGL_SOURCE_DIRS: readonly string[] = [
  path.resolve(__dirname, "../../../src/webgl"),
  path.resolve(__dirname),
];

const ALLOWED_CATCH_FILES: readonly string[] = [
  path.resolve(__dirname, "comparison.spec.ts"),
  path.resolve(__dirname, "harness/main.ts"),
];

function collectTypeScriptFiles(dir: string): readonly string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectTypeScriptFiles(fullPath);
    }
    if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      return [fullPath];
    }
    return [];
  });
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

describe("WebGL error visibility", () => {
  const files = WEBGL_SOURCE_DIRS.flatMap(collectTypeScriptFiles);

  it("keeps substitute-rendering branches out of WebGL renderer code", () => {
    const disallowedWord = new RegExp("\\b[Ff]all" + "back\\b|falling " + "back");
    const offenders = files
      .map((filePath) => ({ filePath, text: readText(filePath) }))
      .filter(({ text }) => disallowedWord.test(text))
      .map(({ filePath }) => path.relative(process.cwd(), filePath));

    expect(offenders).toEqual([]);
  });

  it("keeps promise rejection handling fail-fast in WebGL renderer code", () => {
    const disallowedCall = "." + "cat" + "ch(";
    const offenders = files
      .map((filePath) => ({ filePath, text: readText(filePath) }))
      .filter(({ text }) => text.includes(disallowedCall))
      .map(({ filePath }) => path.relative(process.cwd(), filePath));

    expect(offenders).toEqual([]);
  });

  it("keeps synchronous exception blocks limited to audited fail-fast sites", () => {
    const catchKeyword = "cat" + "ch";
    const catchPattern = new RegExp(`${catchKeyword}\\s*\\(`);
    const offenders = files
      .map((filePath) => ({ filePath, text: readText(filePath) }))
      .filter(({ text }) => catchPattern.test(text))
      .filter(({ filePath }) => !ALLOWED_CATCH_FILES.includes(filePath))
      .map(({ filePath }) => path.relative(process.cwd(), filePath));

    expect(offenders).toEqual([]);

    const comparisonSpec = readText(path.resolve(__dirname, "comparison.spec.ts"));
    expect(comparisonSpec).toContain("throw new Error(`resvg failed for ${frameName}:");
    expect(comparisonSpec).toContain("renderErrors.push(`${frameName}:");
    expect(comparisonSpec).toContain("expect(renderErrors, `Render errors:");

    const harnessMain = readText(path.resolve(__dirname, "harness/main.ts"));
    expect(harnessMain).toContain("throw err;");
  });
});
