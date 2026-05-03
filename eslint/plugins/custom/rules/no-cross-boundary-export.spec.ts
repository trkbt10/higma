/**
 * @file Unit tests for no-cross-boundary-export ESLint rule.
 */
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import rule from "./no-cross-boundary-export.js";

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parser: tseslint.parser,
  },
});

tester.run("no-cross-boundary-export", rule, {
  valid: [
    // Same-directory re-exports
    `export * from "./foo";`,
    `export { bar } from "./bar";`,
    // Sub-directory re-exports
    `export * from "./sub/baz";`,
    `export { x } from "./sub/deep/mod";`,
    // Package re-exports
    `export { useState } from "react";`,
    `export * from "lodash";`,
    // Regular exports (no source)
    `export const x = 1;`,
    `export function foo() {}`,
  ],
  invalid: [
    {
      code: `export * from "../foo";`,
      errors: [{ messageId: "noCrossBoundary" }],
    },
    {
      code: `export { bar } from "../bar";`,
      errors: [{ messageId: "noCrossBoundary" }],
    },
    {
      code: `export * from "../../deep/mod";`,
      errors: [{ messageId: "noCrossBoundary" }],
    },
    {
      code: `export * as ns from "../ns";`,
      errors: [{ messageId: "noCrossBoundary" }],
    },
    {
      code: `export type { Foo } from "../types";`,
      errors: [{ messageId: "noCrossBoundary" }],
    },
  ],
});
