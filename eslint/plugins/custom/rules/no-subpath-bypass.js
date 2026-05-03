/**
 * @file ESLint rule: enforce subpath export consistency.
 *
 * Reads the nearest package.json "exports" field and enforces that
 * barrel and wildcard subpath exports are mutually exclusive.
 *
 * Given exports:
 *   { "./domain/*": "./src/domain/*.ts" }
 *
 * Then:
 *   - src/domain/index.ts must NOT exist (no barrel alongside wildcard)
 *   - import from "@pkg/domain" is prohibited (use "@pkg/domain/user" instead)
 *
 * Given exports:
 *   { "./domain": "./src/domain/index.ts" }
 *
 * Then:
 *   - import from "@pkg/domain/user" is prohibited (use "@pkg/domain" barrel)
 *   - "./domain/*" wildcard must NOT coexist in exports
 *
 * This rule also detects inconsistent exports definitions at parse-time:
 *   - { "./domain": "...", "./domain/*": "..." } is always an error.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";

/**
 * Find the nearest package.json by walking up from a directory.
 * @param {string} startDir - Starting directory
 * @returns {{ dir: string, pkg: object } | null}
 */
function findPackageJson(startDir) {
  const root = resolve("/");
  for (let dir = startDir; dir !== root; dir = dirname(dir)) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        return { dir, pkg };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Extract subpath groups from exports.
 * Groups paths like "./domain" and "./domain/*" together.
 * @param {Record<string, unknown>} exports - The exports field
 * @returns {Map<string, { hasBarrel: boolean, hasWildcard: boolean }>}
 */
function analyzeExports(exports) {
  /** @type {Map<string, { hasBarrel: boolean, hasWildcard: boolean }>} */
  const groups = new Map();

  for (const key of Object.keys(exports)) {
    // Skip the root export "."
    if (key === ".") {
      continue;
    }

    // Check for wildcard pattern like "./domain/*"
    const wildcardMatch = key.match(/^(\.\/[^*]+)\/\*$/);
    if (wildcardMatch) {
      const base = wildcardMatch[1];
      const group = groups.get(base) ?? { hasBarrel: false, hasWildcard: false };
      group.hasWildcard = true;
      groups.set(base, group);
      continue;
    }

    // Check for barrel pattern like "./domain" (not containing *)
    if (!key.includes("*")) {
      // Only consider top-level subpaths (e.g., "./domain", not "./domain/something")
      const parts = key.split("/");
      if (parts.length === 2) {
        const group = groups.get(key) ?? { hasBarrel: false, hasWildcard: false };
        group.hasBarrel = true;
        groups.set(key, group);
      }
    }
  }

  return groups;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce that barrel and wildcard subpath exports are mutually exclusive, " +
        "and prevent imports that bypass the chosen strategy.",
      recommended: true,
    },
    schema: [],
    messages: {
      conflictingExports:
        "Package exports has both '{{base}}' (barrel) and '{{base}}/*' (wildcard). " +
        "These are mutually exclusive. Remove one.",
      barrelIndexForbidden:
        "index.ts exists at '{{indexPath}}' but exports uses wildcard '{{base}}/*'. " +
        "With wildcard exports, barrel index files must not exist.",
      barrelImportForbidden:
        "Import from '{{importPath}}' is prohibited. " +
        "Exports uses wildcard pattern '{{base}}/*'. Import a specific module instead.",
      wildcardImportForbidden:
        "Import from '{{importPath}}' bypasses the barrel export '{{base}}'. " +
        "Import from '{{base}}' instead of reaching into internal modules.",
    },
  },

  create(context) {
    const filename = context.filename;
    const fileDir = dirname(filename);
    const result = findPackageJson(fileDir);

    if (!result) {
      return {};
    }

    const { dir: packageDir, pkg } = result;
    const exports = pkg.exports;

    if (!exports || typeof exports !== "object") {
      return {};
    }

    const packageName = pkg.name;
    if (!packageName) {
      return {};
    }

    const groups = analyzeExports(exports);
    const rel = relative(packageDir, filename).replace(/\\/g, "/");

    // Check for conflicting exports and barrel index files
    // (only report once per file, on Program node)
    const programChecks = [];

    for (const [base, info] of groups) {
      // Conflicting: both barrel and wildcard
      if (info.hasBarrel && info.hasWildcard) {
        programChecks.push({
          messageId: "conflictingExports",
          data: { base },
        });
        continue;
      }

      // Wildcard-only: check that index.ts doesn't exist in the directory
      if (info.hasWildcard && !info.hasBarrel) {
        const subDir = base.replace(/^\.\//, "");
        const indexTsPath = join("src", subDir, "index.ts");
        const indexTsxPath = join("src", subDir, "index.tsx");

        // Only report if the current file IS the forbidden index.ts
        if (rel === indexTsPath || rel === indexTsxPath) {
          programChecks.push({
            messageId: "barrelIndexForbidden",
            data: { indexPath: rel, base },
          });
        }
      }
    }

    /**
     * Check import declarations against subpath export rules.
     * @param {object} node - AST node
     */
    function checkImport(node) {
      const importPath = node.source?.value;
      if (!importPath || typeof importPath !== "string") {
        return;
      }

      // Only check imports from this package
      if (!importPath.startsWith(packageName)) {
        return;
      }

      // Get the subpath (e.g., "@higma/core/domain/user" -> "./domain/user")
      const subpath = "./" + importPath.slice(packageName.length + 1);

      for (const [base, info] of groups) {
        // Wildcard-only: barrel import is forbidden
        if (info.hasWildcard && !info.hasBarrel) {
          if (subpath === base || subpath === base + "/index") {
            context.report({
              node: node.source,
              messageId: "barrelImportForbidden",
              data: { importPath, base },
            });
            return;
          }
        }

        // Barrel-only: wildcard-style deep import is forbidden
        if (info.hasBarrel && !info.hasWildcard) {
          if (subpath.startsWith(base + "/") && subpath !== base + "/index") {
            context.report({
              node: node.source,
              messageId: "wildcardImportForbidden",
              data: { importPath, base },
            });
            return;
          }
        }
      }
    }

    return {
      Program(node) {
        for (const check of programChecks) {
          context.report({
            node,
            messageId: check.messageId,
            data: check.data,
          });
        }
      },
      ImportDeclaration: checkImport,
    };
  },
};
