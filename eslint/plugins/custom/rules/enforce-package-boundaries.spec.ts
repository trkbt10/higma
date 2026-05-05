/**
 * @file Unit tests for package boundary metadata ESLint rule.
 */
import { resolve } from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import rule from "./enforce-package-boundaries.js";

const cwd = process.cwd();

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parser: tseslint.parser,
  },
});

describe("enforce-package-boundaries", () => {
  tester.run("enforce-package-boundaries", rule, {
    valid: [
      {
        code: 'import type { DeckDocument } from "@higma-document-models/deck";',
        filename: resolve(cwd, "packages/@higma-document-editors/deck/src/index.ts"),
      },
      {
        code: 'import { dfsById } from "@higma-primitives/tree";',
        filename: resolve(cwd, "packages/@higma-editor-surfaces/controls/src/shape-editor/query.ts"),
      },
      {
        code: 'import { parseFigCanvasHeader } from "@higma-figma-containers/canvas";',
        filename: resolve(cwd, "packages/@higma-document-io/site/src/index.ts"),
      },
      {
        code: 'import { createSingleSelection } from "@higma-editor-kernel/core/selection";',
        filename: resolve(cwd, "packages/@higma-editor-surfaces/controls/src/canvas/EditorCanvas.tsx"),
      },
    ],
    invalid: [
      {
        code: 'import type { FigDesignDocument } from "@higma-document-models/fig/domain";',
        filename: resolve(cwd, "packages/@higma-document-models/deck/src/index.ts"),
        errors: [{ messageId: "scope" }],
      },
      {
        code: 'import { loadDeckDocumentShell } from "@higma-document-io/deck";',
        filename: resolve(cwd, "packages/@higma-document-models/deck/src/index.ts"),
        errors: [{ messageId: "layer" }],
      },
      {
        code: 'import { createSingleSelection } from "@higma-editor-kernel/core/selection";',
        filename: resolve(cwd, "packages/@higma-document-models/fig/src/domain/document.ts"),
        errors: [{ messageId: "editor" }],
      },
      {
        code: 'import { isFigCanvasMagic } from "@higma-figma-schema/profiles";',
        filename: resolve(cwd, "packages/@higma-figma-schema/node-types/src/index.ts"),
        errors: [{ messageId: "scope" }],
      },
    ],
  });
});
