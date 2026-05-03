/**
 * @file ESLint rule to disallow re-export declarations outside designated entry points.
 *
 * Allowed entry points:
 *   - src/index.ts or src/index.tsx (relative to the nearest package.json)
 *   - Files corresponding to paths listed in package.json "exports"
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, dirname, join } from "node:path";

/**
 * Recursively collect all file-path strings from a package.json "exports" value.
 */
function collectExportPaths(value) {
  const results = [];
  if (typeof value === "string") {
    results.push(value);
  } else if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) {
      results.push(...collectExportPaths(v));
    }
  }
  return results;
}

/**
 * Convert an export path to the set of possible source paths (relative to package root).
 * e.g. "./dist/utils/index.js" → {"src/utils/index.ts", "src/utils/index.tsx"}
 *      "./src/domain/user.ts" → {"src/domain/user.ts"}
 */
function toSourcePaths(exportPath) {
  const base = exportPath.replace(/^\.\//, "");

  // If the path already points to a .ts/.tsx source file, use it as-is
  if (base.endsWith(".ts") || base.endsWith(".tsx")) {
    return [base];
  }

  const normalized = base
    .replace(/^dist\//, "src/")
    .replace(/\.(js|mjs|cjs)$/, "");
  return [normalized + ".ts", normalized + ".tsx"];
}

/**
 * Find the nearest package.json directory by walking up from a given directory.
 * @param {string} startDir - The directory to start searching from
 * @returns {string | null} - The directory containing package.json, or null
 */
function findPackageRoot(startDir) {
  let dir = startDir;
  const root = resolve("/");
  while (dir !== root) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow re-export declarations outside of designated entry point files (src/index.ts(x) or package.json exports).",
    },
    schema: [],
    messages: {
      noReexport:
        "Re-export is only allowed in entry point files (src/index.ts(x) or package.json exports).",
    },
  },
  create(context) {
    const filename = context.filename;
    const fileDir = dirname(filename);

    // Find the nearest package.json (handles monorepo packages)
    const packageRoot = findPackageRoot(fileDir);
    if (!packageRoot) {
      return {};
    }

    const rel = relative(packageRoot, filename).replace(/\\/g, "/");

    // Allow src/index.ts(x)
    if (/^src\/index\.tsx?$/.test(rel)) {
      return {};
    }

    // Collect allowed source paths from package.json exports
    const allowedPaths = new Set();
    try {
      const pkg = JSON.parse(
        readFileSync(resolve(packageRoot, "package.json"), "utf8"),
      );
      if (pkg.exports) {
        for (const ep of collectExportPaths(pkg.exports)) {
          for (const sp of toSourcePaths(ep)) {
            allowedPaths.add(sp);
          }
        }
      }
    } catch {
      // package.json not found or unreadable — skip
    }

    if (allowedPaths.has(rel)) {
      return {};
    }

    // This file is not an entry point — forbid re-exports
    function check(node) {
      if (node.source) {
        context.report({ node, messageId: "noReexport" });
      }
    }

    return {
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
    };
  },
};
