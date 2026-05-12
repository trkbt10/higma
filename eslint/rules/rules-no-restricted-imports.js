/**
 * @file Rule group: forbid loading specific modules.
 *
 * Covers two concerns:
 *
 * 1. Test libraries — globals injected by the test runner should be used
 *    instead of named imports from bun:test / vitest / @jest/globals /
 *    jest / mocha. The boundary keeps spec files runnable under any
 *    runner without rewriting imports.
 *
 * 2. The deleted `fig-file` builder. Phase 0b/0c of the SoT consolidation
 *    refactor (see `docs/refactor/sot-consolidation/PROGRESS.md`) removed
 *    `@higma-document-io/fig/fig-file` and the `createFigFile()` mutable
 *    builder. The canonical path is now `createEmptyFigDesignDocument` +
 *    `addPage(internalOnly?)` + `addNode({state, doc, pageId, parentId,
 *    spec})` + `updateNode` + `addImage` + `addBlob` + `exportFig(doc)`.
 *    This rule guards the consolidation against silent regressions.
 */

const TEST_LIB_MESSAGE =
  "Do not import test libraries. Use globals injected by the test runner (describe/it/expect).";

const FIG_FILE_MESSAGE =
  "fig-file was removed in Phase 0b-2. Use createEmptyFigDesignDocument + addNode + exportFig from @higma-document-io/fig instead.";

export default {
  // ES Module imports
  "no-restricted-imports": [
    "error",
    {
      paths: [
        { name: "bun:test", message: TEST_LIB_MESSAGE },
        { name: "vitest", message: TEST_LIB_MESSAGE },
        { name: "@jest/globals", message: TEST_LIB_MESSAGE },
        { name: "jest", message: TEST_LIB_MESSAGE },
        { name: "mocha", message: TEST_LIB_MESSAGE },
        { name: "@higma-document-io/fig/fig-file", message: FIG_FILE_MESSAGE },
      ],
      patterns: [
        {
          group: ["vitest/*", "jest/*", "mocha/*"],
          message: TEST_LIB_MESSAGE,
        },
        {
          group: ["@higma-document-io/fig/fig-file/*"],
          message: FIG_FILE_MESSAGE,
        },
      ],
    },
  ],

  // CommonJS requires (kept for legacy code paths even though the
  // codebase is ESM-first; ensures the ban surfaces under both module
  // systems).
  "no-restricted-modules": [
    "error",
    {
      paths: ["bun:test", "vitest", "@jest/globals", "jest", "mocha", "@higma-document-io/fig/fig-file"],
      patterns: ["vitest/*", "jest/*", "mocha/*", "@higma-document-io/fig/fig-file/*"],
    },
  ],
};
