/**
 * @file ESLint rule to enforce imports through index.ts when a directory has one.
 *
 * If src/anything/index.ts exists, external files must import through the
 * directory (index.ts) rather than reaching into internal files directly.
 * Files inside the same directory are exempt.
 */
import { existsSync } from "node:fs";
import { resolve, dirname, relative, basename, isAbsolute } from "node:path";

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce imports through index.ts when the directory has one, preserving the public layer boundary.",
    },
    schema: [],
    messages: {
      useIndex:
        "Import through '{{indexDir}}' instead of accessing internal files directly. The directory has an index.ts that serves as the public API layer.",
    },
  },
  create(context) {
    const cwd = context.cwd;
    const filename = context.filename;
    const fileDir = dirname(filename);
    const srcRoot = resolve(cwd, "src");

    /** Cache for existsSync results. */
    const indexCache = new Map();

    function hasIndex(dirPath) {
      if (indexCache.has(dirPath)) {
        return indexCache.get(dirPath);
      }
      const result =
        existsSync(resolve(dirPath, "index.ts")) ||
        existsSync(resolve(dirPath, "index.tsx"));
      indexCache.set(dirPath, result);
      return result;
    }

    function isInsideDir(filePath, dirPath) {
      const rel = relative(dirPath, filePath);
      return !rel.startsWith("..") && !isAbsolute(rel);
    }

    function check(node) {
      const source = node.source?.value;
      if (!source || !source.startsWith(".")) {
        return;
      }

      const resolved = resolve(fileDir, source);

      // Determine if the import goes through a directory's index.ts
      const isDirectoryImport = hasIndex(resolved);
      const isExplicitIndex = basename(resolved) === "index";

      // Start directory for ancestor walk:
      // - Directory import (./foo → foo/index.ts): skip foo/ itself, start from parent
      // - Explicit index (./foo/index): same — skip foo/, start from parent
      // - File import (./foo/bar): start from foo/
      const startDir = isExplicitIndex
        ? dirname(dirname(resolved))
        : isDirectoryImport
          ? dirname(resolved)
          : dirname(resolved);

      // Walk ancestor directories from startDir up to (but not including) srcRoot
      const walkAncestors = (dir) => {
        if (!dir.startsWith(srcRoot) || dir === srcRoot) {
          return;
        }
        if (hasIndex(dir) && !isInsideDir(filename, dir)) {
          context.report({
            node,
            messageId: "useIndex",
            data: { indexDir: relative(cwd, dir) },
          });
          return;
        }
        walkAncestors(dirname(dir));
      };
      walkAncestors(startDir);
    }

    return {
      ImportDeclaration: check,
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
    };
  },
};
