/**
 * @file Unit tests for enforce-index-import ESLint rule.
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
// describe, beforeAll, afterAll are injected by the test runner
import rule from "./enforce-index-import.js";

const cwd = process.cwd();
const srcRoot = resolve(cwd, "src");

// Temporary directory structure for tests:
//   src/__test_idx__/index.ts
//   src/__test_idx__/internal.ts
//   src/__test_idx__/sub/index.ts
//   src/__test_idx__/sub/deep.ts
//   src/__test_idx_no_index__/foo.ts   (no index.ts)
const testDir = resolve(srcRoot, "__test_idx__");
const testSub = resolve(testDir, "sub");
const testNoIndex = resolve(srcRoot, "__test_idx_no_index__");

describe("enforce-index-import", () => {
  beforeAll(() => {
    mkdirSync(testSub, { recursive: true });
    mkdirSync(testNoIndex, { recursive: true });
    writeFileSync(resolve(testDir, "index.ts"), "export {};\n");
    writeFileSync(resolve(testDir, "internal.ts"), "export const x = 1;\n");
    writeFileSync(resolve(testSub, "index.ts"), "export {};\n");
    writeFileSync(resolve(testSub, "deep.ts"), "export const y = 2;\n");
    writeFileSync(resolve(testNoIndex, "foo.ts"), "export const z = 3;\n");
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
    rmSync(testNoIndex, { recursive: true, force: true });
  });

  const tester = new RuleTester({
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: tseslint.parser,
    },
  });

  tester.run("enforce-index-import", rule, {
    valid: [
      // Importing directory (through index) from outside
      {
        code: 'import { x } from "./__test_idx__";',
        filename: resolve(srcRoot, "other.ts"),
      },
      // Importing sub-directory through its index from inside parent
      {
        code: 'import { y } from "./sub";',
        filename: resolve(testDir, "index.ts"),
      },
      // Internal file from within the SAME directory (index.ts importing siblings)
      {
        code: 'import { x } from "./internal";',
        filename: resolve(testDir, "index.ts"),
      },
      // Sibling import within the same directory
      {
        code: 'import { x } from "./internal";',
        filename: resolve(testDir, "other.ts"),
      },
      // Internal file within sub-directory
      {
        code: 'import { y } from "./deep";',
        filename: resolve(testSub, "index.ts"),
      },
      // Directory without index.ts — direct import is fine
      {
        code: 'import { z } from "./__test_idx_no_index__/foo";',
        filename: resolve(srcRoot, "other.ts"),
      },
      // Package import (non-relative)
      {
        code: 'import { useState } from "react";',
        filename: resolve(srcRoot, "other.ts"),
      },
      // Regular local export (no source)
      {
        code: "export const a = 1;",
        filename: resolve(testDir, "internal.ts"),
      },
    ],
    invalid: [
      // Bypassing index.ts from outside the directory
      {
        code: 'import { x } from "./__test_idx__/internal";',
        filename: resolve(srcRoot, "other.ts"),
        errors: [{ messageId: "useIndex" }],
      },
      // Bypassing index.ts from a different directory
      {
        code: 'import { x } from "../__test_idx__/internal";',
        filename: resolve(srcRoot, "components/Button.ts"),
        errors: [{ messageId: "useIndex" }],
      },
      // Deep import bypassing parent index.ts
      {
        code: 'import { y } from "./__test_idx__/sub/deep";',
        filename: resolve(srcRoot, "other.ts"),
        errors: [{ messageId: "useIndex" }],
      },
      // Bypassing sub/index.ts from parent directory
      {
        code: 'import { y } from "./sub/deep";',
        filename: resolve(testDir, "index.ts"),
        errors: [{ messageId: "useIndex" }],
      },
      // export-from also caught
      {
        code: 'export { x } from "./__test_idx__/internal";',
        filename: resolve(srcRoot, "other.ts"),
        errors: [{ messageId: "useIndex" }],
      },
      // export type from also caught
      {
        code: 'export type { Foo } from "./__test_idx__/internal";',
        filename: resolve(srcRoot, "other.ts"),
        errors: [{ messageId: "useIndex" }],
      },
    ],
  });
});
