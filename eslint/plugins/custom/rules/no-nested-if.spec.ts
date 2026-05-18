/**
 * @file Unit tests for no-nested-if ESLint rule.
 */
import { RuleTester } from "eslint";
import rule from "./no-nested-if.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

ruleTester.run("no-nested-if", rule, {
  valid: [
    {
      // Sequential ifs at the same level — not nested.
      code: `
        function fn(a, b) {
          if (a) return 1;
          if (b) return 2;
          return 3;
        }
      `,
    },
    {
      // Plain if/else without nesting.
      code: `
        function fn(a) {
          if (a) {
            doX();
          } else {
            doY();
          }
        }
      `,
    },
    {
      // `else if` is handled by a different rule, not this one.
      code: `
        function fn(a, b) {
          if (a) {
            doX();
          } else if (b) {
            doY();
          }
        }
      `,
    },
    {
      // If inside a function body that is itself inside an if — the inner if
      // belongs to a new function scope, not the outer if directly.
      code: `
        function fn(a) {
          if (a) {
            const helper = () => {
              if (true) return 1;
              return 0;
            };
            helper();
          }
        }
      `,
    },
  ],
  invalid: [
    {
      // if-inside-consequent (block)
      code: `
        function fn(a, b) {
          if (a) {
            if (b) {
              doX();
            }
          }
        }
      `,
      errors: [{ messageId: "noNestedIf" }],
    },
    {
      // if-inside-consequent (no block — relies on permissive curly config)
      code: `
        function fn(a, b) {
          if (a) if (b) doX();
        }
      `,
      errors: [{ messageId: "noNestedIf" }],
    },
    {
      // if-inside-consequent — not the first statement of the block
      code: `
        function fn(a, b) {
          if (a) {
            doSetup();
            if (b) doX();
          }
        }
      `,
      errors: [{ messageId: "noNestedIf" }],
    },
    {
      // if-inside-else block (explicit braces around else body)
      code: `
        function fn(a, b) {
          if (a) {
            doX();
          } else {
            if (b) {
              doY();
            }
          }
        }
      `,
      errors: [{ messageId: "noNestedIf" }],
    },
    {
      // both branches contain nested ifs — both reported.
      code: `
        function fn(a, b, c) {
          if (a) {
            if (b) doX();
          } else {
            if (c) doY();
          }
        }
      `,
      errors: [{ messageId: "noNestedIf" }, { messageId: "noNestedIf" }],
    },
  ],
});
