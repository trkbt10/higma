/**
 * @file Ordered list of lint rules.
 *
 * Order matters for readability of the report — earliest rules
 * surface the most foundational problems first (zip → canvas →
 * schema → message → nodes), so a user fixing the file from the
 * top down hits structural blockers before per-node issues.
 */

import { canvasHeaderRule } from "./canvas-header";
import { imageRefsRule } from "./image-refs";
import { parentRefsRule } from "./parent-refs";
import { requiredNodesRule } from "./required-nodes";
import { schemaCoverageRule } from "./schema-coverage";
import { shapeFieldsRule } from "./shape-fields";
import { visibleBlobsRule } from "./visible-blobs";
import { zipPackageRule } from "./zip-package";
import type { LintRule } from "../types";

export const FIG_LINT_RULES: readonly LintRule[] = [
  zipPackageRule,
  canvasHeaderRule,
  schemaCoverageRule,
  requiredNodesRule,
  shapeFieldsRule,
  visibleBlobsRule,
  parentRefsRule,
  imageRefsRule,
];
