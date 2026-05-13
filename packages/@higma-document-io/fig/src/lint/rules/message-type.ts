/**
 * @file Message.type integrity rule.
 *
 * A `.fig` carrying document content must declare its top-level
 * `Message.type` as `NODE_CHANGES` (value 1 in the bundled Kiwi
 * `MessageType` enum). Any other value — `JOIN_START` / `JOIN_END` /
 * `SIGNAL` / etc. — describes a session-sync message, not document
 * content, and Figma's importer rejects such files with "Internal
 * error during import" before it ever reads `nodeChanges`.
 *
 * This rule exists because a regression in `exportFresh` once wrote
 * `type: { value: 0, name: "FULL_DOCUMENT" }` (no such name in the
 * schema; value 0 is `JOIN_START`), silently producing files that
 * looked structurally correct but every generator-built fixture
 * failed to import. The lint rule catches the same shape at file
 * scan time so a future regression can't ship.
 */

import type { LintRule } from "../types";

const REQUIRED_TYPE_NAME = "NODE_CHANGES";

function readMessageType(
  message: Record<string, unknown>,
): { value: unknown; name: unknown } | undefined {
  const t = message.type;
  if (t === null || t === undefined || typeof t !== "object") {
    return undefined;
  }
  return t as { value: unknown; name: unknown };
}

export const messageTypeRule: LintRule = (ctx, emit) => {
  if (!ctx.message) {
    return;
  }
  const t = readMessageType(ctx.message);
  if (!t) {
    emit({
      ruleId: "fig.message.type",
      severity: "error",
      path: "canvas.fig/message.type",
      message: "Message.type is missing — Figma's importer requires NODE_CHANGES",
      remediation:
        "Rebuild with `exportFig` (uses `createNodeChangesMessageHeader` from `@higma-document-models/fig/domain`)",
    });
    return;
  }
  if (t.name !== REQUIRED_TYPE_NAME) {
    emit({
      ruleId: "fig.message.type",
      severity: "error",
      path: "canvas.fig/message.type",
      message:
        `Message.type is "${String(t.name)}" (value=${String(t.value)}); ` +
        `document-content .fig files must use "${REQUIRED_TYPE_NAME}". ` +
        `Other values describe session-sync messages Figma's importer rejects.`,
      remediation:
        "Rebuild with `exportFig` (uses `createNodeChangesMessageHeader` from `@higma-document-models/fig/domain`)",
    });
  }
};
