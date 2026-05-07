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
      {
        code: 'export { MousePointer2 as SelectIcon } from "lucide-react";',
        options: [{ allowedPackageSources: ["lucide-react"] }],
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
    ],
  });
});
