/**
 * @file Unit tests for cross-package re-export hygiene.
 */
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import rule from "./no-cross-package-reexport.js";

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parser: tseslint.parser,
  },
});

describe("no-cross-package-reexport", () => {
  tester.run("no-cross-package-reexport", rule, {
    valid: [
      {
        code: 'export { localValue } from "./local";',
      },
      {
        code: 'export { localValue } from "../local";',
      },
      // Local-relative type alias passes through — no external package involved.
      {
        code: 'import type { Bar } from "./bar";\nexport type Baz = Bar;',
      },
      // Structural derivations from an imported package type construct a new
      // type and therefore are not bare republications.
      {
        code:
          'import { useMemo } from "react";\n' +
          'export type UseMemoArgs = Parameters<typeof useMemo>[0];',
      },
      {
        code: 'import type { Foo } from "@some/pkg";\nexport type FooList = readonly Foo[];',
      },
    ],
    invalid: [
      {
        code: 'export { parseFigCanvasHeader } from "@higma-figma-containers/canvas";',
        errors: [{ messageId: "directReexport" }],
      },
      {
        code: 'export { useFigSceneGraph, type UseFigSceneGraphParams } from "@higma-figma-runtime/react-renderer";',
        errors: [{ messageId: "directReexport" }],
      },
      {
        code: 'export { useState } from "react";',
        errors: [{ messageId: "directReexport" }],
      },
      {
        code: 'export { MousePointer2 as SelectIcon } from "lucide-react";',
        errors: [{ messageId: "directReexport" }],
      },
      {
        code: 'export { map } from "lodash/fp";',
        errors: [{ messageId: "directReexport" }],
      },
      {
        code: 'export type { Stats } from "node:fs";',
        errors: [{ messageId: "directReexport" }],
      },
      {
        code: 'import { parseFigCanvasHeader } from "@higma-figma-containers/canvas";\nexport { parseFigCanvasHeader };',
        errors: [{ messageId: "indirectReexport" }],
      },
      {
        code: 'import { useMemo } from "react";\nexport { useMemo };',
        errors: [{ messageId: "indirectReexport" }],
      },
      {
        code: 'import * as canvas from "@higma-figma-containers/canvas";\nexport { canvas };',
        errors: [{ messageId: "indirectNamespaceExport" }],
      },
      {
        code: 'import * as React from "react";\nexport { React };',
        errors: [{ messageId: "indirectNamespaceExport" }],
      },
      {
        code: 'import { parseFigCanvasHeader } from "@higma-figma-containers/canvas";\nexport const parse = parseFigCanvasHeader;',
        errors: [{ messageId: "indirectReexport" }],
      },
      {
        code: 'import React from "react";\nexport default React;',
        errors: [{ messageId: "indirectDefaultExport" }],
      },
      // Bare type alias republication of an imported package type.
      {
        code:
          'import type { FigDesignDocument } from "@higma-document-models/fig/domain";\n' +
          'export type FigFamilyDesignDocument = FigDesignDocument;',
        errors: [{ messageId: "indirectTypeAliasReexport" }],
      },
      {
        code:
          'import type { FigDocumentResources } from "@higma-document-io/fig/context";\n' +
          'export type FigFamilyDocumentResources = FigDocumentResources;',
        errors: [{ messageId: "indirectTypeAliasReexport" }],
      },
    ],
  });
});
