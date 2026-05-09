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
  // Indexing the system-font catalogue is a multi-file batch where
  // one unreadable file (corrupt cmap, exotic kern subtable, missing
  // decoder) must NOT abort the rest of the scan. The catch in
  // node-loader drops a single offending file from the index —
  // callers asking for that family still get `undefined` so the
  // failure remains observable at the loadFont call site, just not
  // at indexing time.
  "src/font-drivers/node/node-loader.ts",
  // Discovery of the OS catalogue depends on external resolvers
  // (`fc-list` on Linux, `reg.exe` on Windows). When the binary is
  // missing or the OS is sandboxed away from it we must fall back
  // to direct directory scanning — that is the documented OS-
  // correct degraded mode. The catch wraps the resolver invocation
  // and returns `undefined`; the caller observes the `linux-dirs`
  // / `win32-dirs` source value in `catalogueSource()`.
  "src/font-drivers/node/discover-linux.ts",
  "src/font-drivers/node/discover-win32.ts",
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
