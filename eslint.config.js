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
      "custom/no-layer-violation": "off",
      "custom/no-subpath-bypass": "off",
      "no-restricted-syntax": "off",
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // higma fig-stack boundary rules
  //
  // Layer direction (low → high). A package in a given layer must not import
  // from any package above it.
  //
  //   L0 — leaf utilities (no inter-package higma deps):
  //         @higma/buffer, @higma/zip, @higma/png,
  //         @higma/ui-components, @higma/editor-core
  //   L1 — fig domain core:        @higma/fig
  //   L2 — fig operations:         @higma/fig-builder, @higma/fig-renderer
  //   L3 — editor primitives:      @higma/editor-controls
  //   L4 — top-level app:          @higma/fig-editor
  //
  // ──────────────────────────────────────────────────────────────────────

  // Re-export hygiene — same rules across all packages.
  {
    files: ["packages/**/*.ts", "packages/**/*.tsx"],
    ignores: ["**/*.spec.ts", "**/*.test.ts"],
    rules: {
      "custom/no-cross-package-reexport": [
        "error",
        {
          packagePrefixes: ["@higma/"],
        },
      ],
      "custom/no-cross-boundary-export": "error",
    },
  },

  // Subpath export consistency.
  {
    files: ["packages/**/*.ts", "packages/**/*.tsx"],
    rules: {
      "custom/no-subpath-bypass": "error",
    },
  },

  // L0 — leaf utilities. No higma packages may be imported.
  {
    files: [
      "packages/@higma/buffer/src/**/*.{ts,tsx}",
      "packages/@higma/zip/src/**/*.{ts,tsx}",
      "packages/@higma/png/src/**/*.{ts,tsx}",
    ],
    rules: {
      "custom/no-layer-violation": [
        "error",
        {
          disallowedPackages: [
            "@higma/fig",
            "@higma/fig-builder",
            "@higma/fig-renderer",
            "@higma/editor-core",
            "@higma/editor-controls",
            "@higma/ui-components",
            "@higma/fig-editor",
          ],
        },
      ],
    },
  },

  // L0 — UI / editor primitives. May not import any other higma package.
  {
    files: [
      "packages/@higma/ui-components/src/**/*.{ts,tsx}",
      "packages/@higma/editor-core/src/**/*.{ts,tsx}",
    ],
    rules: {
      "custom/no-layer-violation": [
        "error",
        {
          disallowedPackages: [
            "@higma/buffer",
            "@higma/zip",
            "@higma/png",
            "@higma/fig",
            "@higma/fig-builder",
            "@higma/fig-renderer",
            "@higma/editor-controls",
            "@higma/fig-editor",
          ],
        },
      ],
    },
  },

  // L1 — @higma/fig domain core. May depend only on L0 leaf utilities
  // (buffer, zip, png). Must not see fig-builder/renderer or any UI layer.
  {
    files: ["packages/@higma/fig/src/**/*.{ts,tsx}"],
    rules: {
      "custom/no-layer-violation": [
        "error",
        {
          disallowedPackages: [
            "@higma/fig-builder",
            "@higma/fig-renderer",
            "@higma/editor-core",
            "@higma/editor-controls",
            "@higma/ui-components",
            "@higma/fig-editor",
          ],
        },
      ],
    },
  },

  // L2 — fig operations. May depend on L0/L1 (fig + leaf utilities).
  // Must not see editor primitives or the app layer.
  {
    files: [
      "packages/@higma/fig-builder/src/**/*.{ts,tsx}",
      "packages/@higma/fig-renderer/src/**/*.{ts,tsx}",
    ],
    rules: {
      "custom/no-layer-violation": [
        "error",
        {
          disallowedPackages: [
            "@higma/editor-core",
            "@higma/editor-controls",
            "@higma/ui-components",
            "@higma/fig-editor",
          ],
        },
      ],
    },
  },

  // L3 — editor primitives. May depend on L0 UI/editor primitives and L1 fig
  // (used as a tree utility source). Must not see fig operations or the app.
  {
    files: ["packages/@higma/editor-controls/src/**/*.{ts,tsx}"],
    rules: {
      "custom/no-layer-violation": [
        "error",
        {
          disallowedPackages: [
            "@higma/fig-builder",
            "@higma/fig-renderer",
            "@higma/fig-editor",
          ],
        },
      ],
    },
  },

  // L4 — @higma/fig-editor is the top of the stack and may import anything.
);
