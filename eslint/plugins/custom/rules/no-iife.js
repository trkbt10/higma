/**
 * @file ESLint rule to disallow IIFE (Immediately Invoked Function Expression) in any context.
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow IIFE in any context (top-level, named, or anonymous parent function)",
    },
    schema: [],
    messages: {
      noIife:
        "IIFE is prohibited. Extract the body into a named helper function and call that instead.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "FunctionExpression" && callee.type !== "ArrowFunctionExpression") {
          return;
        }
        context.report({ node, messageId: "noIife" });
      },
    };
  },
};
