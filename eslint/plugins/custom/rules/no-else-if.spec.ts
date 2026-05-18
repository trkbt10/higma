/**
 * @file Unit tests for no-else-if ESLint rule.
 */
import { RuleTester } from "eslint";
import rule from "./no-else-if.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

ruleTester.run("no-else-if", rule, {
  valid: [
    {
      // Plain if without else.
      code: `
        function fn(a) {
          if (a) return 1;
          return 0;
        }
      `,
    },
    {
      // Plain if/else without chained else-if.
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
      // `else { if(...) }` is intentionally NOT flagged by this rule.
      // It is covered by no-nested-if.
      code: `
        function fn(a, b) {
          if (a) {
            doX();
          } else {
            if (b) doY();
          }
        }
      `,
    },
    {
      // Sequential ifs are fine.
      code: `
        function fn(a, b) {
          if (a) return 1;
          if (b) return 2;
          return 3;
        }
      `,
    },
  ],
  invalid: [
    {
      // Single else-if.
      code: `
        function fn(a, b) {
          if (a) {
            doX();
          } else if (b) {
            doY();
          }
        }
      `,
      errors: [{ messageId: "noElseIf" }],
    },
    {
      // else-if with a trailing else branch.
      code: `
        function fn(a, b) {
          if (a) {
            doX();
          } else if (b) {
            doY();
          } else {
            doZ();
          }
        }
      `,
      errors: [{ messageId: "noElseIf" }],
    },
    {
      // Chained else-if-else-if-else — each link is reported.
      code: `
        function fn(a, b, c) {
          if (a) {
            doA();
          } else if (b) {
            doB();
          } else if (c) {
            doC();
          } else {
            doD();
          }
        }
      `,
      errors: [{ messageId: "noElseIf" }, { messageId: "noElseIf" }],
    },
  ],
});
