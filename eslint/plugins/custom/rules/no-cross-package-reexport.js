/**
 * @file Custom rule: prohibit re-exports from package imports.
 *
 * Disallows patterns like:
 *   export type { Foo } from "@higma-document-models/fig/domain"
 *   export { bar } from "@higma-primitives/tree"
 *   export * from "@higma-document-io/fig"
 *   export { useState } from "react"
 *   export { map } from "lodash/fp"
 *
 * Also disallows indirect re-exports:
 *   import type { Foo } from "@higma-document-models/fig/domain"
 *   export type { Foo }               // ← prohibited
 *
 *   import { bar } from "@higma-primitives/tree"
 *   export { bar }                    // ← prohibited
 *   export default bar                // ← prohibited
 */

/**
 * Check if a specifier targets a package instead of a local file.
 * @param {string} path - The import/export path
 * @returns {boolean} - true when the specifier is a package/builtin alias
 */
function isPackageSpecifier(path) {
  if (!path || typeof path !== "string") {
    return false;
  }

  if (path.startsWith(".") || path.startsWith("/")) {
    return false;
  }

  return true;
}

/**
 * Determine the import type from an import specifier
 * @param {object} node - The import declaration node
 * @param {object} specifier - The import specifier
 * @returns {'named' | 'default' | 'namespace' | 'type'} - The resolved import type
 */
function resolveImportType(node, specifier) {
  if (node.importKind === "type" || specifier.importKind === "type") {
    return "type";
  }
  if (specifier.type === "ImportNamespaceSpecifier") {
    return "namespace";
  }
  if (specifier.type === "ImportDefaultSpecifier") {
    return "default";
  }
  return "named";
}

/**
 * @typedef {Object} ExternalImportInfo
 * @property {string} source - The import source path
 * @property {'named' | 'default' | 'namespace' | 'type'} type - Type of import
 */

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow re-exports from any package import",
      recommended: true,
    },
    schema: [],
    messages: {
      directReexport:
        "Re-exporting from external package '{{source}}' is prohibited. " +
        "Consumers should import directly from the source package.",
      indirectReexport:
        "Re-exporting '{{name}}' that was imported from '{{source}}'. " +
        "Consumers should import directly from the source package instead of through this module.",
      indirectDefaultExport:
        "Exporting '{{name}}' as default, which was imported from '{{source}}'. " +
        "Consumers should import directly from the source package.",
      indirectNamespaceExport:
        "Re-exporting namespace '{{name}}' from '{{source}}'. " +
        "Consumers should import directly from the source package.",
    },
  },

  create(context) {
    /** @type {Map<string, ExternalImportInfo>} */
    const externalImports = new Map();

    function trackImport(node) {
      const sourcePath = node.source?.value;
      if (!sourcePath) {
        return;
      }

      if (!isPackageSpecifier(sourcePath)) {
        return;
      }

      for (const specifier of node.specifiers || []) {
        const localName = specifier.local?.name;
        if (!localName) {
          continue;
        }

        const importType = resolveImportType(node, specifier);

        externalImports.set(localName, {
          source: sourcePath,
          type: importType,
        });
      }
    }

    function checkDirectReexport(node) {
      if (node.source == null) {
        return;
      }

      const sourcePath = node.source?.value;
      if (!sourcePath) {
        return;
      }

      if (isPackageSpecifier(sourcePath)) {
        context.report({
          node: node.source,
          messageId: "directReexport",
          data: {
            source: sourcePath,
          },
        });
      }
    }

    function checkIndirectReexport(node) {
      if (node.source != null) {
        return;
      }

      for (const specifier of node.specifiers || []) {
        const localName = specifier.local?.name;
        if (!localName) {
          continue;
        }

        const importInfo = externalImports.get(localName);
        if (importInfo) {
          const messageId = importInfo.type === "namespace" ? "indirectNamespaceExport" : "indirectReexport";

          context.report({
            node: specifier,
            messageId,
            data: {
              name: localName,
              source: importInfo.source,
            },
          });
        }
      }
    }

    function checkExportedVariableDeclaration(node) {
      if (node.declaration?.type !== "VariableDeclaration") {
        return;
      }

      for (const declaration of node.declaration.declarations || []) {
        if (declaration.id?.type !== "Identifier" || declaration.init?.type !== "Identifier") {
          continue;
        }

        const importInfo = externalImports.get(declaration.init.name);
        if (!importInfo) {
          continue;
        }

        context.report({
          node: declaration.id,
          messageId: "indirectReexport",
          data: {
            name: declaration.id.name,
            source: importInfo.source,
          },
        });
      }
    }

    function checkExportDefaultDeclaration(node) {
      if (node.declaration?.type === "Identifier") {
        const name = node.declaration.name;
        const importInfo = externalImports.get(name);
        if (importInfo) {
          context.report({
            node: node.declaration,
            messageId: "indirectDefaultExport",
            data: {
              name,
              source: importInfo.source,
            },
          });
        }
      }
    }

    return {
      ImportDeclaration: trackImport,
      ExportAllDeclaration: checkDirectReexport,
      ExportNamedDeclaration(node) {
        checkDirectReexport(node);
        checkIndirectReexport(node);
        checkExportedVariableDeclaration(node);
      },
      ExportDefaultDeclaration: checkExportDefaultDeclaration,
    };
  },
};
