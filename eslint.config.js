/**
 * @file ESLint flat config for the monorepo.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import jsdocPlugin from "eslint-plugin-jsdoc";
import eslintCommentsPlugin from "@eslint-community/eslint-plugin-eslint-comments";
import prettierConfig from "eslint-config-prettier";
// Local plugin and modularized rule groups
import customPlugin from "./eslint/plugins/custom/index.js";
import rulesJSDoc from "./eslint/rules/rules-jsdoc.js";
import rulesRestrictedSyntax from "./eslint/rules/rules-restricted-syntax.js";
import rulesCurly from "./eslint/rules/rules-curly.js";
import rulesNoTestImports from "./eslint/rules/rules-no-test-imports.js";
import rulesNoMocks from "./eslint/rules/rules-no-mocks.js";

export default tseslint.config(
  // Ignore patterns
  {
    ignores: [
      "node_modules/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "debug/**",
      "*.config.ts",
      "packages/*/vitest.config.ts",
      "packages/*/vite.config.ts",
    ],
  },

  // JS/TS recommended sets (Flat-compatible)
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettierConfig],
  },

  // Project common rules (all TypeScript files)
  {
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      import: importPlugin,
      jsdoc: jsdocPlugin,
      "@eslint-community/eslint-comments": eslintCommentsPlugin,
      "@typescript-eslint": tseslint.plugin,
      custom: customPlugin,
    },
    settings: {
      jsdoc: { mode: "typescript" },
    },
    rules: {
      // Custom rules
      "custom/ternary-length": "error",
      "custom/prefer-node-protocol": "error",
      "custom/no-as-outside-guard": "error",
      "custom/no-nested-try": "error",
      "custom/no-iife-in-anonymous": "error",
      "custom/no-cross-boundary-export": "error",
      "custom/no-reexport-outside-entry": "error",
      "custom/enforce-index-import": "error",

      // Spread from modular groups
      ...rulesJSDoc,
      ...rulesRestrictedSyntax,
      ...rulesCurly,
      ...rulesNoTestImports,
      ...rulesNoMocks,
    },
  },

  // Tests-only: allow global test APIs so imports are unnecessary
  {
    files: [
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        suite: "readonly",
        bench: "readonly",
      },
    },
  },

  // Internal ESLint plugin/rules: don't enforce custom rules on their own source
  {
    files: ["eslint/**"],
    rules: {
      "custom/ternary-length": "off",
      "custom/no-as-outside-guard": "off",
      "custom/no-nested-try": "off",
      "custom/no-iife-in-anonymous": "off",
      "custom/no-cross-boundary-export": "off",
      "custom/no-reexport-outside-entry": "off",
      "custom/enforce-index-import": "off",
      "custom/no-cross-package-reexport": "off",
      "custom/no-core-barrel-import": "off",
      "custom/no-core-reverse-dependency": "off",
      "custom/no-subpath-bypass": "off",
      "no-restricted-syntax": "off",
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Monorepo boundary rules
  // ──────────────────────────────────────────────────────────────────────

  // 1. Prohibit re-exports from other workspace packages.
  //    Consumers must import directly from the source package.
  {
    files: ["packages/**/*.ts", "packages/**/*.tsx"],
    ignores: ["**/*.spec.ts", "**/*.test.ts"],
    rules: {
      "custom/no-cross-package-reexport": [
        "error",
        {
          packagePrefixes: ["@monorepo/"],
        },
      ],
    },
  },

  // 2. Prohibit barrel imports from @monorepo/core/dto and @monorepo/core/domain.
  //    Import from specific modules instead (e.g., @monorepo/core/dto/user).
  {
    files: ["packages/**/*.ts", "packages/**/*.tsx"],
    rules: {
      "custom/no-core-barrel-import": [
        "error",
        {
          barrelPaths: ["@monorepo/core/dto", "@monorepo/core/domain"],
        },
      ],
    },
  },

  // 3. Prohibit core from importing api or web (reverse dependency).
  //    Dependency direction: api -> core <- web
  {
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "custom/no-core-reverse-dependency": [
        "error",
        {
          disallowedPackages: ["@monorepo/api", "@monorepo/web"],
        },
      ],
    },
  },

  // 4. Prohibit re-exports that traverse parent directories (../).
  {
    files: ["packages/**/*.ts", "packages/**/*.tsx"],
    ignores: ["**/*.spec.ts", "**/*.test.ts"],
    rules: {
      "custom/no-cross-boundary-export": "error",
    },
  },

  // 5. Enforce subpath export consistency.
  //    If exports has "./domain/*" wildcard, "./domain" barrel must not exist.
  //    If exports has "./domain" barrel, "./domain/*" wildcard must not exist.
  {
    files: ["packages/**/*.ts", "packages/**/*.tsx"],
    rules: {
      "custom/no-subpath-bypass": "error",
    },
  },
);
