/** @file Repository-wide checks that renderer errors remain observable. */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS: readonly string[] = [
  path.join(ROOT, "src"),
  path.join(ROOT, "spec"),
  path.join(ROOT, "scripts"),
];

const ZERO_SUBSTITUTE_RENDERING_DIRS: readonly string[] = [
  path.join(ROOT, "src/webgl"),
  path.join(ROOT, "src/svg/nodes/text"),
  path.join(ROOT, "spec/renderer/webgl"),
];

const ALLOWED_EXCEPTION_FILES = new Set([
  "src/scene-graph/boolean-operation.ts",
  "spec/renderer/webgl/comparison.spec.ts",
  "spec/renderer/webgl/harness/main.ts",
]);

function collectFiles(dir: string): readonly string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(fullPath);
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      return [fullPath];
    }
    return [];
  });
}

function relativePath(filePath: string): string {
  return path.relative(ROOT, filePath);
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function filesContaining(pattern: RegExp, dirs: readonly string[]): readonly string[] {
  return dirs
    .flatMap(collectFiles)
    .filter((filePath) => pattern.test(readText(filePath)))
    .map(relativePath)
    .sort();
}

describe("renderer error visibility", () => {
  const substitutePattern = new RegExp("\\b[Ff]all" + "back\\b|falling " + "back|[Ff]all through");
  const promiseHandler = "." + "cat" + "ch(";
  const exceptionHandlerPattern = new RegExp("cat" + "ch\\s*\\(");

  it("keeps substitute-rendering branches out of WebGL and SVG text", () => {
    const offenders = filesContaining(substitutePattern, ZERO_SUBSTITUTE_RENDERING_DIRS);

    expect(offenders).toEqual([]);
  });

  it("keeps substitute-rendering branches out of fig-renderer", () => {
    const offenders = filesContaining(substitutePattern, SCAN_DIRS);

    expect(offenders).toEqual([]);
  });

  it("keeps promise handlers fail-fast", () => {
    const offenders = SCAN_DIRS
      .flatMap(collectFiles)
      .filter((filePath) => readText(filePath).includes(promiseHandler))
      .filter((filePath) => {
        const text = readText(filePath);
        return !(relativePath(filePath).startsWith("scripts/") && text.includes("process.exitCode = 1"));
      })
      .map(relativePath)
      .sort();

    expect(offenders).toEqual([]);
  });

  it("keeps synchronous exception handling limited to observable-result sites", () => {
    const offenders = SCAN_DIRS
      .flatMap(collectFiles)
      .filter((filePath) => exceptionHandlerPattern.test(readText(filePath)))
      .filter((filePath) => !relativePath(filePath).startsWith("scripts/"))
      .filter((filePath) => !ALLOWED_EXCEPTION_FILES.has(relativePath(filePath)))
      .map(relativePath)
      .sort();

    expect(offenders).toEqual([]);
  });
});
