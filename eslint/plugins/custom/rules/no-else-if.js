/**
 * @file ESLint rule to disallow `else if` chains.
 *
 * In ESTree, the inner `if` of `else if (cond)` is represented as an IfStatement that
 * appears directly as the `.alternate` of the outer IfStatement (without an intervening
 * BlockStatement). This rule matches exactly that shape.
 *
 * `else { if (cond) { ... } }` is NOT reported here — that pattern is covered by
 * `no-nested-if`, which reports any `if` placed inside an `else` block.
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow `else if` chains",
    },
    schema: [],
    messages: {
      noElseIf:
        "`else if` is prohibited. Use early returns, a lookup table, or extract each branch as a named helper.",
    },
  },
  create(context) {
    return {
      "IfStatement > IfStatement.alternate"(node) {
        context.report({ node, messageId: "noElseIf" });
      },
    };
  },
};
