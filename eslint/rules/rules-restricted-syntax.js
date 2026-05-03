/**
 * @file Rule group: 2. Prohibit specific syntax
 */

export default {
  "no-restricted-syntax": [
    "warn",
    { selector: "ImportExpression", message: "dynamic import() is prohibited" },
    { selector: "TSImportType", message: "type import() (TS import type expression) is prohibited" },
    { selector: "TSInterfaceDeclaration", message: "Please use type instead of interface" },
    { selector: "ExportAllDeclaration[exported!=null]", message: "export * as is prohibited" },
    { selector: "ExportAllDeclaration[exportKind='type']", message: "export type * from is prohibited" },
    {
      selector:
        "ClassDeclaration" +
        ":not(:has(TSClassImplements[expression.name='Error']))" +
        ":not([superClass.name='Error'])" +
        ":not([superClass.property.name='Error'])" +
        ":not([superClass.object.name='globalThis'][superClass.property.name='Error'])",
      message: "Class implementation is not recommended. Please write as function-based as much as possible.",
    },
    {
      selector:
        "VariableDeclaration[kind='let']" +
        ":not(ForStatement > VariableDeclaration)" +
        ":not(ForInStatement > VariableDeclaration)" +
        ":not(ForOfStatement > VariableDeclaration)",
      message:
        "Use of let is prohibited. If you need to branch, create a separate function and use its return value. If absolutely necessary for performance issues, explicitly use // eslint-disable-next-line.",
    },
    {
      selector: "TSAsExpression TSAnyKeyword",
      message:
        "Avoid using 'as any'. Code using 'as any' may indicate incorrect type definitions or a misunderstanding; review it carefully. Resolve this by using appropriate type guards or correct typings instead.",
    },
    {
      selector: "TSTypeAssertion TSAnyKeyword",
      message:
        "Avoid using 'as any'. Code using 'as any' may indicate incorrect type definitions or a misunderstanding; review it carefully. Resolve this by using appropriate type guards or correct typings instead.",
    },
    {
      selector:
        "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|fn|spyOn|restoreAllMocks|resetAllMocks)$/]",
      message: "Mock APIs (vi.mock/fn/spyOn/...) are prohibited. Prefer DI or simple fakes instead.",
    },
    {
      selector:
        "CallExpression[callee.object.name='jest'][callee.property.name=/^(mock|fn|spyOn|restoreAllMocks|resetAllMocks)$/]",
      message: "Mock APIs (jest.mock/fn/spyOn/...) are prohibited. Prefer DI or simple fakes instead.",
    },
    {
      selector:
        "CallExpression[callee.object.name='mock'][callee.property.name=/^(module|object|replace|restore|reset)$/]",
      message: "Mock APIs (bun:test mock.*) are prohibited. Prefer DI or simple fakes instead.",
    },
    {
      selector: "CatchClause:not([param])",
      message: "catch clause must declare an error parameter. Omitting it silently swallows errors.",
    },
    {
      selector: "CatchClause > BlockStatement[body.length=0]",
      message: "Empty catch block is prohibited. Handle the error or rethrow it.",
    },
  ],

  // Catch clause must always declare an error parameter.
  // `catch { ... }` without a parameter silently swallows errors.
  // `catch (e) { ... }` where e is unused is caught by no-unused-vars.
  "no-unused-vars": "off",
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      caughtErrors: "all",
      caughtErrorsIgnorePattern: "^$",
    },
  ],

  "@typescript-eslint/consistent-type-definitions": ["error", "type"],

  "@eslint-community/eslint-comments/require-description": [
    "warn",
    {
      ignore: [],
    },
  ],
};
