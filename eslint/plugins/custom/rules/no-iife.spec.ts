/**
 * @file Unit tests for no-iife ESLint rule.
 */
import { RuleTester } from "eslint";
import rule from "./no-iife.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

ruleTester.run("no-iife", rule, {
  valid: [
    {
      code: `
        // Regular named function call is allowed
        function helper() {
          return 1;
        }
        helper();
      `,
    },
    {
      code: `
        // Regular function call inside a function is allowed
        function outer() {
          someFunction();
        }
      `,
    },
    {
      code: `
        // Calling a stored function reference is not an IIFE
        const fn = () => 1;
        fn();
      `,
    },
    {
      code: `
        // Calling a method is not an IIFE
        const obj = { run: () => 1 };
        obj.run();
      `,
    },
  ],
  invalid: [
    {
      code: `
        // Top-level arrow IIFE
        (() => {
          console.log('hello');
        })();
      `,
      errors: [{ messageId: "noIife" }],
    },
    {
      code: `
        // Top-level function-expression IIFE
        (function () {
          console.log('hello');
        })();
      `,
      errors: [{ messageId: "noIife" }],
    },
    {
      code: `
        // IIFE inside a named function declaration
        function namedFunc() {
          (() => {
            console.log('hello');
          })();
        }
      `,
      errors: [{ messageId: "noIife" }],
    },
    {
      code: `
        // IIFE inside a named function expression
        const namedFunc = function named() {
          (() => {
            console.log('hello');
          })();
        };
      `,
      errors: [{ messageId: "noIife" }],
    },
    {
      code: `
        // IIFE inside an arrow function
        const fn = () => {
          (() => {
            console.log('hello');
          })();
        };
      `,
      errors: [{ messageId: "noIife" }],
    },
    {
      code: `
        // IIFE inside an anonymous function expression
        const fn = function () {
          (() => {
            console.log('hello');
          })();
        };
      `,
      errors: [{ messageId: "noIife" }],
    },
    {
      code: `
        // IIFE as a const initializer (try/catch scoping idiom)
        const result = (() => {
          try {
            return { ok: true };
          } catch (err) {
            return { ok: false };
          }
        })();
      `,
      errors: [{ messageId: "noIife" }],
    },
    {
      code: `
        // Nested IIFE — reports each call site
        const outer = () => {
          const inner = () => {
            (() => {
              console.log('hello');
            })();
          };
        };
      `,
      errors: [{ messageId: "noIife" }],
    },
  ],
});
