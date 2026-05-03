/**
 * @file Unit tests for no-reexport-outside-entry ESLint rule.
 */
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import rule from "./no-reexport-outside-entry.js";

const cwd = process.cwd();

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parser: tseslint.parser,
  },
});

tester.run("no-reexport-outside-entry", rule, {
  valid: [
    // Entry point src/index.ts — re-exports allowed
    {
      code: `export * from "./foo";`,
      filename: `${cwd}/src/index.ts`,
    },
    {
      code: `export { bar } from "./bar";`,
      filename: `${cwd}/src/index.ts`,
    },
    {
      code: `export * from "./baz";`,
      filename: `${cwd}/src/index.tsx`,
    },
    // Non-entry files — regular exports are fine
    {
      code: `export const x = 1;`,
      filename: `${cwd}/src/utils/math.ts`,
    },
    {
      code: `export function foo() {}`,
      filename: `${cwd}/src/lib/helper.ts`,
    },
    {
      code: `export type Foo = { a: number };`,
      filename: `${cwd}/src/types.ts`,
    },
  ],
  invalid: [
    // Non-entry file with re-export
    {
      code: `export * from "./internal";`,
      filename: `${cwd}/src/utils/index.ts`,
      errors: [{ messageId: "noReexport" }],
    },
    {
      code: `export { foo } from "./foo";`,
      filename: `${cwd}/src/lib/barrel.ts`,
      errors: [{ messageId: "noReexport" }],
    },
    {
      code: `export type { Bar } from "./bar";`,
      filename: `${cwd}/src/types/index.ts`,
      errors: [{ messageId: "noReexport" }],
    },
    {
      code: `export * as utils from "./utils";`,
      filename: `${cwd}/src/sub/mod.ts`,
      errors: [{ messageId: "noReexport" }],
    },
  ],
});
