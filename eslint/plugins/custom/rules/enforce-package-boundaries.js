/**
 * @file Custom rule: enforce package dependency boundaries from package metadata.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ruleFilePath = fileURLToPath(import.meta.url);
// Resolve the repo root from this rule's own location rather than process.cwd()
// so per-package eslint invocations (which set cwd to the package directory)
// still locate `packages/`. Layout: <repoRoot>/eslint/plugins/custom/rules/<this>.
const repoRoot = path.resolve(path.dirname(ruleFilePath), "..", "..", "..", "..");
const packagesRoot = path.join(repoRoot, "packages");

let packageCache;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getPackageNameFromSpecifier(specifier) {
  if (!specifier.startsWith("@")) {
    return undefined;
  }
  const parts = specifier.split("/");
  if (parts.length < 2) {
    return undefined;
  }
  return `${parts[0]}/${parts[1]}`;
}

function discoverPackages() {
  if (packageCache) {
    return packageCache;
  }

  const byName = new Map();
  const byDir = [];
  for (const scope of fs.readdirSync(packagesRoot)) {
    const scopeDir = path.join(packagesRoot, scope);
    if (!fs.statSync(scopeDir).isDirectory()) {
      continue;
    }
    for (const packageDirName of fs.readdirSync(scopeDir)) {
      const packageDir = path.join(scopeDir, packageDirName);
      const packageJsonPath = path.join(packageDir, "package.json");
      if (!fs.existsSync(packageJsonPath)) {
        continue;
      }
      const packageJson = readJson(packageJsonPath);
      const boundary = packageJson.higma?.boundary;
      if (!boundary) {
        continue;
      }
      const entry = {
        boundary,
        dir: packageDir,
        name: packageJson.name,
      };
      byName.set(packageJson.name, entry);
      byDir.push(entry);
    }
  }

  byDir.sort((a, b) => b.dir.length - a.dir.length);
  packageCache = { byDir, byName };
  return packageCache;
}

function getSourcePackage(filename) {
  const absoluteFilename = path.resolve(filename);
  const packages = discoverPackages();
  return packages.byDir.find((entry) => absoluteFilename.startsWith(`${entry.dir}${path.sep}`));
}

function getTargetPackage(specifier) {
  const packageName = getPackageNameFromSpecifier(specifier);
  if (!packageName) {
    return undefined;
  }
  return discoverPackages().byName.get(packageName);
}

function isEditorFamily(family) {
  return family === "editor-kernel" || family === "editor-surface";
}

function isDocumentProductFamily(family) {
  return family.startsWith("document-");
}

function isPackageSelfImport(sourcePackage, targetPackage) {
  return sourcePackage.name === targetPackage.name;
}

/**
 * Roundtrip-bridge packages drive sibling product packages on purpose:
 * a single package (`@higma-tools/web-fig-roundtrip`) exists specifically to
 * compose `web-to-fig` + `fig-to-web` + the fig renderer / model / IO so it
 * can verify visual fidelity end-to-end. Without this role flag those
 * imports would trip the sibling and peer-product checks even though the
 * composition is the package's entire reason to exist.
 *
 * The exemption is opted into per-package by setting
 * `higma.boundary.role = "roundtrip-bridge"` in package.json; only the
 * declared roundtrip-bridge package gets the relaxation, so the rule
 * remains uniform for every other tools-family package.
 */
function isRoundtripBridge(boundary) {
  return boundary.role === "roundtrip-bridge";
}

function getPackageScope(packageName) {
  const parts = packageName.split("/");
  return parts[0];
}

function isSameScopePeerPackage(sourcePackage, targetPackage) {
  return getPackageScope(sourcePackage.name) === getPackageScope(targetPackage.name);
}

function report(context, node, messageId, sourcePackage, targetPackage) {
  context.report({
    node: node.source,
    messageId,
    data: {
      source: sourcePackage.name,
      target: targetPackage.name,
    },
  });
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Enforce package dependency boundaries from higma.boundary metadata.",
      recommended: true,
    },
    schema: [],
    messages: {
      layer:
        "Package boundary violation: '{{source}}' must not import higher layer package '{{target}}'.",
      horizontal:
        "Package boundary violation: '{{source}}' must not import same-layer package '{{target}}'. Extract shared code to a lower layer.",
      scope:
        "Package boundary violation: '{{source}}' must not import sibling package '{{target}}' from the same scope.",
      product:
        "Package boundary violation: '{{source}}' must not import peer product package '{{target}}'.",
      editor:
        "Package boundary violation: '{{source}}' must not import editor package '{{target}}'. Only editor packages and document editors may depend on editor packages.",
    },
  },

  create(context) {
    function check(node) {
      const specifier = node.source?.value;
      if (typeof specifier !== "string") {
        return;
      }

      const sourcePackage = getSourcePackage(context.filename);
      const targetPackage = getTargetPackage(specifier);
      if (!sourcePackage || !targetPackage || isPackageSelfImport(sourcePackage, targetPackage)) {
        return;
      }

      const sourceBoundary = sourcePackage.boundary;
      const targetBoundary = targetPackage.boundary;
      // Roundtrip-bridge packages are exempt from the sibling-scope and
      // peer-product checks because composing both ends of a conversion
      // pipeline (e.g. web-to-fig + fig-to-web + fig renderer) is the
      // package's declared purpose. Layer / editor / horizontal checks
      // below still apply so the bridge cannot reach upward or sideways
      // into unrelated families.
      const sourceIsRoundtripBridge = isRoundtripBridge(sourceBoundary);
      if (!sourceIsRoundtripBridge && isSameScopePeerPackage(sourcePackage, targetPackage)) {
        report(context, node, "scope", sourcePackage, targetPackage);
        return;
      }

      if (
        !sourceIsRoundtripBridge &&
        sourceBoundary.product &&
        targetBoundary.product &&
        sourceBoundary.product !== targetBoundary.product
      ) {
        report(context, node, "product", sourcePackage, targetPackage);
        return;
      }

      if (
        isEditorFamily(targetBoundary.family) &&
        !isEditorFamily(sourceBoundary.family) &&
        sourceBoundary.family !== "document-editor"
      ) {
        report(context, node, "editor", sourcePackage, targetPackage);
        return;
      }

      if (targetBoundary.layer > sourceBoundary.layer) {
        report(context, node, "layer", sourcePackage, targetPackage);
        return;
      }

      if (
        targetBoundary.layer === sourceBoundary.layer &&
        sourceBoundary.family === targetBoundary.family &&
        isDocumentProductFamily(sourceBoundary.family)
      ) {
        report(context, node, "horizontal", sourcePackage, targetPackage);
      }
    }

    return {
      ImportDeclaration: check,
      ExportAllDeclaration: check,
      ExportNamedDeclaration(node) {
        if (node.source) {
          check(node);
        }
      },
    };
  },
};
