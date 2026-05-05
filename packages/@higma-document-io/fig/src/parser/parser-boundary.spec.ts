/**
 * @file Boundary gates prevent drift for fig parser and validator ownership.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type PackageJson = {
  readonly exports?: Readonly<Record<string, unknown>>;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../../..");
const modelPackageRoot = join(repoRoot, "packages/@higma-document-models/fig");
const ioPackageRoot = join(repoRoot, "packages/@higma-document-io/fig");

function readPackageJson(packageRoot: string): PackageJson {
  return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as PackageJson;
}

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return sourceFiles(path);
    }
    if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      return [path];
    }
    return [];
  });
}

function assertPackageBoundaryLintPreventsParserValidatorDrift(): void {
  const modelPackage = readPackageJson(modelPackageRoot);
  expect(modelPackage.exports?.["./parser"]).toBeUndefined();
  expect(modelPackage.exports?.["./validator"]).toBeUndefined();
}

function assertDocumentIoParserValidatorEntryPointsRemainObservable(): void {
  const ioPackage = readPackageJson(ioPackageRoot);
  expect(ioPackage.exports?.["./parser"]).toBeDefined();
  expect(ioPackage.exports?.["./validator"]).toBeDefined();
}

function assertModelToIoParserValidatorBoundaryViolationIsAbsent(): void {
  const modelSource = sourceFiles(join(modelPackageRoot, "src"));
  for (const file of modelSource) {
    const source = readFileSync(file, "utf8");
    expect(source).not.toContain("@higma-document-io/fig/parser");
    expect(source).not.toContain("@higma-document-io/fig/validator");
  }
}

describe("fig parser IO boundary drift gate", () => {
  it("keeps parser and validator public exports out of the model package", () => {
    assertPackageBoundaryLintPreventsParserValidatorDrift();
  });

  it("keeps parser and validator public exports in the document IO package", () => {
    assertDocumentIoParserValidatorEntryPointsRemainObservable();
  });

  it("keeps document model source independent from document IO parser and validator imports", () => {
    assertModelToIoParserValidatorBoundaryViolationIsAbsent();
  });
});
