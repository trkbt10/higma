/**
 * @file Custom rule: prohibit barrel imports from @monorepo/core/dto and @monorepo/core/domain.
 *
 * Disallowed:
 *   import { User } from '@monorepo/core/domain'
 *   import { UserResponse } from '@monorepo/core/dto'
 *   import type { UserId } from '@monorepo/core/domain/index'
 *
 * Allowed:
 *   import { User } from '@monorepo/core/domain/user'
 *   import { UserResponse } from '@monorepo/core/dto/user'
 *   import type { UserId } from '@monorepo/core/domain/user'
 *
 * Configurable:
 *   - barrelPaths: string[] (default: ["@monorepo/core/dto", "@monorepo/core/domain"])
 */

/**
 * Check if an import path is a core barrel import
 * @param {string} importPath - The import source path
 * @param {string[]} barrelPaths - The barrel paths to check
 * @returns {string | null} - The matched barrel path, or null if no match
 */
function isCoreBarrelImport(importPath, barrelPaths) {
  for (const barrelPath of barrelPaths) {
    if (importPath === barrelPath) {
      return barrelPath;
    }

    if (importPath === `${barrelPath}/index`) {
      return barrelPath;
    }
  }

  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow barrel imports from @monorepo/core/dto and @monorepo/core/domain",
      recommended: true,
    },
    schema: [
      {
        type: "object",
        properties: {
          barrelPaths: {
            type: "array",
            items: { type: "string" },
            default: ["@monorepo/core/dto", "@monorepo/core/domain"],
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noCoreBarrel:
        "Barrel import from '{{barrelPath}}' is prohibited. " +
        "Import directly from the specific module (e.g., '{{barrelPath}}/user').",
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const barrelPaths = options.barrelPaths ?? ["@monorepo/core/dto", "@monorepo/core/domain"];

    return {
      ImportDeclaration(node) {
        const importPath = node.source?.value;
        if (!importPath || typeof importPath !== "string") {
          return;
        }

        const matchedBarrel = isCoreBarrelImport(importPath, barrelPaths);
        if (matchedBarrel) {
          context.report({
            node: node.source,
            messageId: "noCoreBarrel",
            data: {
              barrelPath: matchedBarrel,
            },
          });
        }
      },
    };
  },
};
