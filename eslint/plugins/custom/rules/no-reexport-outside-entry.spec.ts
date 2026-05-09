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
    // Non-entry files: structural derivations of an imported type construct a
    // new type, so they are not pass-through republications.
    {
      code: `import type { Foo } from "./foo";\nexport type FooList = readonly Foo[];`,
      filename: `${cwd}/src/lib/derive.ts`,
    },
    {
      code: `import { fn } from "./fn";\nexport type Args = Parameters<typeof fn>[0];`,
      filename: `${cwd}/src/lib/derive.ts`,
    },
    // Non-entry files: a locally-defined identifier may be exported under any
    // name; only identifiers that came from an `import` are considered re-exports.
    {
      code: `const local = 1;\nexport { local };`,
      filename: `${cwd}/src/lib/local.ts`,
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
    // Indirect re-export: import then export the same name from a non-entry file.
    {
      code: `import { foo } from "./foo";\nexport { foo };`,
      filename: `${cwd}/src/lib/relay.ts`,
      errors: [{ messageId: "noIndirectReexport" }],
    },
    {
      code: `import type { Bar } from "./bar";\nexport type { Bar };`,
      filename: `${cwd}/src/lib/relay.ts`,
      errors: [{ messageId: "noIndirectReexport" }],
    },
    {
      code: `import { foo } from "@some/pkg";\nexport { foo };`,
      filename: `${cwd}/src/lib/relay.ts`,
      errors: [{ messageId: "noIndirectReexport" }],
    },
    // Indirect type alias re-export: `export type Alias = ImportedType;`
    {
      code: `import type { Bar } from "./bar";\nexport type Baz = Bar;`,
      filename: `${cwd}/src/lib/relay.ts`,
      errors: [{ messageId: "noIndirectTypeAliasReexport" }],
    },
    {
      code: `import type { Bar } from "@some/pkg";\nexport type Baz = Bar;`,
      filename: `${cwd}/src/lib/relay.ts`,
      errors: [{ messageId: "noIndirectTypeAliasReexport" }],
    },
  ],
});
