/**
 * @file Required display-field rule.
 *
 * Every non-DOCUMENT node in a Figma export carries `visible` and
 * `opacity`. Kiwi's binary format encodes them with implicit zero
 * defaults, so a builder that omits them produces a .fig whose layers
 * are all hidden / fully transparent in Figma's editor — the bug is
 * invisible in the renderers (they treat `undefined` as "visible /
 * opaque") and only surfaces when a human opens the file.
 *
 * This rule is the post-construction half of the contract; the
 * compile-time half lives in `types/spec-types.ts` where the same
 * fields are required on `BaseNodeSpec`. Both halves reference the
 * same SoT constant — `REQUIRED_NODE_DISPLAY_FIELDS` — so the two
 * layers stay in lockstep.
 */

import type { FigNode } from "@higma-document-models/fig/types";
import {
  DISPLAY_FIELD_CHECKS,
  nodeRequiresDisplayFields,
} from "../../types/required-fields";
import type { LintFinding, LintRule } from "../types";

function describeNode(node: FigNode, index: number): string {
  const guid = node.guid;
  const guidLabel = guid ? `${guid.sessionID}:${guid.localID}` : "?";
  const typeLabel = node.type?.name ?? "UNKNOWN";
  const nameLabel = node.name ? ` "${node.name}"` : "";
  return `nodeChanges[${index}] ${typeLabel}${nameLabel} (guid=${guidLabel})`;
}

export const displayFieldsRule: LintRule = (ctx, emit) => {
  if (ctx.nodeChanges.length === 0) {
    return;
  }
  for (const [index, node] of ctx.nodeChanges.entries()) {
    if (!nodeRequiresDisplayFields(node)) {
      continue;
    }
    const findings: LintFinding[] = [];
    for (const check of DISPLAY_FIELD_CHECKS) {
      const value = check.read(node);
      if (value !== undefined && value !== null) {
        continue;
      }
      findings.push({
        ruleId: "fig.shape.display-fields",
        severity: "error",
        path: `${describeNode(node, index)}.${check.name}`,
        message: `${check.name} is required on every non-DOCUMENT node — Figma's wire format reads "absent" as the zero value, which hides the layer`,
        remediation: check.remediation,
      });
    }
    for (const finding of findings) {
      emit(finding);
    }
  }
};
