/**
 * @file ESLint flat config for the higma.
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
import rulesNoRestrictedImports from "./eslint/rules/rules-no-restricted-imports.js";
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
      // Hidden TS files (`.foo.ts`) and `.tmp.ts` files are local
      // ad-hoc debug / scratch — excluded from formal lint by convention
      // (the `.tmp` suffix is the project-wide marker for "throwaway").
      "**/.*.ts",
      "**/*.tmp.ts",
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
      "custom/no-inline-dfs-by-id": "error",

      // Spread from modular groups
      ...rulesJSDoc,
      ...rulesRestrictedSyntax,
      ...rulesCurly,
      ...rulesNoRestrictedImports,
      ...rulesNoMocks,
    },
  },

  // Tests-only: allow global test APIs so imports are unnecessary
  {
    files: ["**/*.spec.ts", "**/*.spec.tsx", "**/*.test.ts", "**/*.test.tsx"],
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
      "custom/no-subpath-bypass": "off",
      "custom/enforce-package-boundaries": "off",
      "custom/no-inline-dfs-by-id": "off",
      "no-restricted-syntax": "off",
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // higma package boundary rules
  //
  // The dependency policy is declared in each package.json under
  // higma.boundary. ESLint reads that metadata and enforces these rules for
  // every package uniformly:
  //   - sibling packages in the same scope may not import each other
  //   - imports may not flow to a higher layer
  //   - packages in the same document-product layer may not import each other
  //   - fig/deck/buzz/site products may not import peer products
  //   - product-free editor packages are visible only to editor packages and
  //     document editors
  //
  // ──────────────────────────────────────────────────────────────────────

  // Re-export hygiene and package boundary enforcement across all packages.
  //
  // Test infrastructure (`*.spec.ts`, the `spec/` tree, and dev-time
  // `scripts/`) is excluded from the boundary rules — those files are
  // not shipped artefacts and may legitimately compose sibling tools
  // for verification (fig-to-swiftui's visual round-trip drives the
  // WebGL renderer from web-fig-roundtrip exactly to detect drift).
  {
    files: ["packages/**/*.ts", "packages/**/*.tsx"],
    ignores: [
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/spec/**/*.ts",
      "**/spec/**/*.tsx",
      "**/scripts/**/*.ts",
      "**/scripts/**/*.tsx",
    ],
    rules: {
      "custom/no-cross-package-reexport": "error",
      "custom/no-cross-boundary-export": "error",
      "custom/enforce-package-boundaries": "error",
    },
  },

  // Subpath export consistency.
  {
    files: ["packages/**/*.ts", "packages/**/*.tsx"],
    rules: {
      "custom/no-subpath-bypass": "error",
    },
  },
);
