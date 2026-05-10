/**
 * @file Image reference integrity rule.
 *
 * Image paints carry a `imageRef` (hex string) that must resolve to
 * an entry in the ZIP's `images/` directory. The lint flags
 * dangling references and orphaned image entries on both sides.
 */

import type { FigNode, FigPaint } from "@higma-document-models/fig/types";
import type { LintRule } from "../types";

function imageRef(paint: FigPaint): string | null {
  const ref = (paint as { image?: { hash?: string }; imageRef?: string }).image?.hash
    ?? (paint as { imageRef?: string }).imageRef;
  if (typeof ref !== "string" || ref.length === 0) {
    return null;
  }
  return ref;
}

function collectImagePaints(nodes: readonly FigNode[]): readonly { ref: string; nodeIndex: number; paintIndex: number }[] {
  const result: { ref: string; nodeIndex: number; paintIndex: number }[] = [];
  for (const [nodeIndex, node] of nodes.entries()) {
    const paints = [...(node.fillPaints ?? []), ...(node.strokePaints ?? []), ...(node.backgroundPaints ?? [])];
    for (const [paintIndex, paint] of paints.entries()) {
      if (paint.type !== "IMAGE") {
        continue;
      }
      const ref = imageRef(paint);
      if (ref) {
        result.push({ ref, nodeIndex, paintIndex });
      }
    }
  }
  return result;
}

export const imageRefsRule: LintRule = (ctx, emit) => {
  if (ctx.nodeChanges.length === 0) {
    return;
  }
  const referenced = collectImagePaints(ctx.nodeChanges);

  const referencedRefs = new Set<string>();
  for (const item of referenced) {
    referencedRefs.add(item.ref);
  }

  if (!ctx.isZip) {
    if (referenced.length > 0) {
      emit({
        ruleId: "fig.image.references",
        severity: "error",
        path: "input",
        message: `${referenced.length} image paint(s) reference images, but the input is not a ZIP package`,
        remediation: "Wrap the canvas data in the ZIP container so images/<ref> entries can resolve",
      });
    }
    return;
  }

  for (const item of referenced) {
    if (!ctx.images.has(item.ref)) {
      emit({
        ruleId: "fig.image.references",
        severity: "error",
        path: `nodeChanges[${item.nodeIndex}].fillPaints[${item.paintIndex}].imageRef`,
        message: `Image ref ${item.ref} is not present in the ZIP's images/ directory`,
        remediation: "Add the missing image bytes via FigFileBuilder.addImage() or fix the imageRef",
      });
    }
  }

  for (const ref of ctx.images.keys()) {
    if (!referencedRefs.has(ref)) {
      emit({
        ruleId: "fig.image.references",
        severity: "warning",
        path: `zip/images/${ref}`,
        message: "Image is present in the ZIP but no paint references it",
        remediation: "Either remove the orphan image or add an IMAGE paint that uses it",
      });
    }
  }
};
