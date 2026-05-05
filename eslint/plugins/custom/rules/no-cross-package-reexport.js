/**
 * @file Custom rule: prohibit re-exports from external workspace packages.
 *
 * Disallows patterns like:
 *   export type { Foo } from "@higma-document-models/fig/domain"
 *   export { bar } from "@higma-primitives/tree"
 *   export * from "@higma-document-io/fig"
 *
 * Also disallows indirect re-exports:
 *   import type { Foo } from "@higma-document-models/fig/domain"
 *   export type { Foo }               // ← prohibited
 *
 *   import { bar } from "@higma-primitives/tree"
 *   export { bar }                    // ← prohibited
 *   export default bar                // ← prohibited
 *
 * Configurable:
 *   - packagePrefixes: string[] - package prefixes to disallow re-exports from
 */

const DEFAULT_PACKAGE_PREFIXES = [
  "@higma-primitives/",
  "@higma-codecs/",
  "@higma-figma-schema/",
  "@higma-figma-containers/",
  "@higma-document-models/",
  "@higma-document-io/",
  "@higma-document-renderers/",
  "@higma-document-editors/",
  "@higma-editor-kernel/",
  "@higma-editor-surfaces/",
];

/**
 * Check if a path matches any of the disallowed package prefixes
 * @param {string} path - The import/export path
 * @param {string[]} prefixes - Array of package prefixes to check
 * @returns {string | null} - The matched prefix, or null if no match
 */
function matchesPackagePrefix(path, prefixes) {
  if (!path || typeof path !== "string") {
    return null;
  }

  if (path.startsWith(".")) {
    return null;
  }

  for (const prefix of prefixes) {
    if (path.startsWith(prefix)) {
      return prefix;
    }
  }

  return null;
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
 * @property {string} matchedPrefix - The matched package prefix
 * @property {'named' | 'default' | 'namespace' | 'type'} type - Type of import
 */

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow re-exports from external packages within the same higma",
      recommended: true,
    },
    schema: [
      {
        type: "object",
        properties: {
          packagePrefixes: {
            type: "array",
            items: { type: "string" },
            default: DEFAULT_PACKAGE_PREFIXES,
          },
        },
        additionalProperties: false,
      },
    ],
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
    const options = context.options[0] || {};
    const packagePrefixes = options.packagePrefixes ?? DEFAULT_PACKAGE_PREFIXES;

    /** @type {Map<string, ExternalImportInfo>} */
    const externalImports = new Map();

    function trackImport(node) {
      const sourcePath = node.source?.value;
      if (!sourcePath) {
        return;
      }

      const matchedPrefix = matchesPackagePrefix(sourcePath, packagePrefixes);
      if (!matchedPrefix) {
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
          matchedPrefix,
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

      const matchedPrefix = matchesPackagePrefix(sourcePath, packagePrefixes);
      if (matchedPrefix) {
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
