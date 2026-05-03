/**
 * @file Custom rule: prohibit core package from importing api or web packages.
 *
 * The core package is the boundary definition layer and must not depend on
 * consumer packages. This rule ensures the dependency direction:
 *   api → core ← web
 *
 * Disallowed (in packages/core):
 *   import { something } from "@monorepo/api"
 *   import { something } from "@monorepo/web"
 *
 * Configurable:
 *   - disallowedPackages: string[] (default: ["@monorepo/api", "@monorepo/web"])
 */

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow core package from importing api or web packages (reverse dependency)",
      recommended: true,
    },
    schema: [
      {
        type: "object",
        properties: {
          disallowedPackages: {
            type: "array",
            items: { type: "string" },
            default: ["@monorepo/api", "@monorepo/web"],
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      reverseDependency:
        "Core package must not import from '{{source}}'. " +
        "The dependency direction is: api → core ← web. Core cannot depend on consumer packages.",
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const disallowedPackages = options.disallowedPackages ?? ["@monorepo/api", "@monorepo/web"];

    function check(node) {
      const sourcePath = node.source?.value;
      if (!sourcePath || typeof sourcePath !== "string") {
        return;
      }

      for (const pkg of disallowedPackages) {
        if (sourcePath === pkg || sourcePath.startsWith(`${pkg}/`)) {
          context.report({
            node: node.source,
            messageId: "reverseDependency",
            data: { source: sourcePath },
          });
          return;
        }
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
