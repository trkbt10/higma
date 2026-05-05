/**
 * @file Unit tests for no-inline-dfs-by-id ESLint rule.
 */

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import rule from "./no-inline-dfs-by-id.js";

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parser: tseslint.parser,
  },
});

tester.run("no-inline-dfs-by-id", rule, {
  valid: [
    {
      code: `
        function walk(nodes, targetId) {
          for (const node of nodes) {
            if (node.name === targetId) { return node; }
          }
          return undefined;
        }
      `,
    },
    {
      code: `
        function walk(nodes, targetId) {
          for (const node of nodes) {
            if (node.id === targetId) { return node; }
          }
          return undefined;
        }
      `,
    },
  ],
  invalid: [
    {
      code: `
        function walk(nodes, targetId) {
          for (const node of nodes) {
            if (node.id === targetId) { return node; }
            const found = walk(node.children, targetId);
            if (found) { return found; }
          }
          return undefined;
        }
      `,
      errors: [{ messageId: "noInlineDfsById" }],
    },
  ],
});
