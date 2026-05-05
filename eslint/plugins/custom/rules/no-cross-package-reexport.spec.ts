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
    ],
    invalid: [
      {
        code: 'export { parseFigCanvasHeader } from "@higma-figma-containers/canvas";',
        errors: [{ messageId: "directReexport" }],
      },
      {
        code: 'import { parseFigCanvasHeader } from "@higma-figma-containers/canvas";\nexport { parseFigCanvasHeader };',
        errors: [{ messageId: "indirectReexport" }],
      },
      {
        code: 'import * as canvas from "@higma-figma-containers/canvas";\nexport { canvas };',
        errors: [{ messageId: "indirectNamespaceExport" }],
      },
      {
        code: 'import { parseFigCanvasHeader } from "@higma-figma-containers/canvas";\nexport const parse = parseFigCanvasHeader;',
        errors: [{ messageId: "indirectReexport" }],
      },
    ],
  });
});
