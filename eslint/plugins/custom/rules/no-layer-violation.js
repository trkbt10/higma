/**
 * @file Custom rule: prohibit a package from importing higher-layer packages.
 *
 * Used to enforce the inter-layer dependency direction in the higuma fig
 * stack. Each layer configures the set of higher-layer packages it must not
 * import from.
 *
 * Layer direction (low → high):
 *   buffer / zip / png / ui-components / editor-core
 *   → fig (foundation domain)
 *   → fig-builder, fig-renderer (fig operations)
 *   → editor-controls (editor primitives, may use fig as utility)
 *   → fig-editor (top-level app composition)
 *
 * Configurable:
 *   - disallowedPackages: string[] — package specifiers a file in the
 *     configured directory must not import from. Match is exact name or
 *     `<name>/` subpath prefix.
 */

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow a package from importing higher-layer packages.",
      recommended: true,
    },
    schema: [
      {
        type: "object",
        properties: {
          disallowedPackages: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["disallowedPackages"],
        additionalProperties: false,
      },
    ],
    messages: {
      layerViolation:
        "Layer violation: this package must not import from '{{source}}'. " +
        "Imports must flow from lower layers to higher layers in the higuma stack.",
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const disallowedPackages = options.disallowedPackages ?? [];

    function check(node) {
      const sourcePath = node.source?.value;
      if (!sourcePath || typeof sourcePath !== "string") {
        return;
      }

      for (const pkg of disallowedPackages) {
        if (sourcePath === pkg || sourcePath.startsWith(`${pkg}/`)) {
          context.report({
            node: node.source,
            messageId: "layerViolation",
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
