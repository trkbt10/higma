/**
 * @file ESLint rule to disallow export declarations that traverse parent directories.
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow re-export declarations with parent directory traversal (../).",
    },
    schema: [],
    messages: {
      noCrossBoundary:
        "Cross-boundary export is forbidden. Do not re-export from parent directories (../).",
    },
  },
  create(context) {
    function check(node) {
      if (node.source && node.source.value && node.source.value.includes("..")) {
        context.report({ node, messageId: "noCrossBoundary" });
      }
    }
    return {
      ExportAllDeclaration: check,
      ExportNamedDeclaration: check,
    };
  },
};
