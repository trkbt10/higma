/**
 * @file ESLint rule to disallow nesting an `if` statement directly inside another `if`'s
 * consequent (then-branch) or `else` block.
 *
 * Notes:
 *   - `else if (cond)` is intentionally NOT reported here. The inner IfStatement of an
 *     `else if` is the `.alternate` of the outer IfStatement (not wrapped in a BlockStatement),
 *     and a dedicated rule (`no-else-if`) handles that pattern with a more specific message.
 *   - `else { if (cond) { ... } }` IS reported, because the inner `if` lives inside the
 *     alternate BlockStatement.
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow nesting an `if` directly inside another `if`'s consequent or `else` block",
    },
    schema: [],
    messages: {
      noNestedIf:
        "Nested `if` inside another `if`/`else` block is prohibited. Use early returns or extract a named helper for the inner branch.",
    },
  },
  create(context) {
    return {
      // `if (a) if (b) ...` — no curly on consequent
      "IfStatement > IfStatement.consequent"(node) {
        context.report({ node, messageId: "noNestedIf" });
      },
      // `if (a) { ...; if (b) ... }` — if inside the consequent block (any position)
      "IfStatement > BlockStatement.consequent > IfStatement"(node) {
        context.report({ node, messageId: "noNestedIf" });
      },
      // `if (a) {} else { ...; if (b) ... }` — if inside the alternate block (any position)
      "IfStatement > BlockStatement.alternate > IfStatement"(node) {
        context.report({ node, messageId: "noNestedIf" });
      },
    };
  },
};
