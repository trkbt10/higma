/**
 * @file Alignment section adapter
 *
 * Consumes the kernel `AlignmentControls` primitive and turns each
 * "align to (axis, position) within parent" intent into a node transform
 * mutation.
 *
 * Parent resolution: the immediate FRAME/SYMBOL ancestor on the active page
 * is used as the alignment container. Page-level children fall back to the
 * page's content bounds (which we model via the first child's parent — i.e.
 * disabled until a parent exists).
 *
 * Coordinate model: alignment writes the pre-rotation top-left position
 * (matching what TransformSection's X/Y inputs edit), so rotated nodes
 * snap their bounding box origin to the parent's edge without losing their
 * rotation. This mirrors how Figma handles aligned-rotated objects.
 */

import { useCallback, useMemo } from "react";
import type { FigDesignNode } from "@higma-document-models/fig/domain";
import { findParentNode } from "@higma-document-io/fig/node-ops";
import { AlignmentControls, type AlignmentAxis, type AlignmentPosition } from "@higma-editor-kernel/ui";
import type { FigEditorAction } from "../../../context/fig-editor/types";
import { useFigEditor } from "../../../context/FigEditorContext";
import { extractRotationDeg, computePreRotationTopLeft } from "../../../context/fig-editor/rotation";
import { createPropertyPrimaryUpdateAction, type PropertyMutationTarget } from "../../properties/property-mutation-target";

type AlignmentSectionProps = {
  readonly node: FigDesignNode;
  readonly target: PropertyMutationTarget;
  readonly dispatch: (action: FigEditorAction) => void;
};

function computeAlignedTopLeft({
  axis,
  position,
  current,
  nodeSize,
  parentSize,
}: {
  readonly axis: AlignmentAxis;
  readonly position: AlignmentPosition;
  readonly current: { readonly x: number; readonly y: number };
  readonly nodeSize: { readonly x: number; readonly y: number };
  readonly parentSize: { readonly x: number; readonly y: number };
}): { readonly x: number; readonly y: number } {
  if (axis === "horizontal") {
    switch (position) {
      case "start":
        return { x: 0, y: current.y };
      case "center":
        return { x: (parentSize.x - nodeSize.x) / 2, y: current.y };
      case "end":
        return { x: parentSize.x - nodeSize.x, y: current.y };
    }
  }
  switch (position) {
    case "start":
      return { x: current.x, y: 0 };
    case "center":
      return { x: current.x, y: (parentSize.y - nodeSize.y) / 2 };
    case "end":
      return { x: current.x, y: parentSize.y - nodeSize.y };
  }
}

function rebuildTransformFromTopLeft(
  node: FigDesignNode,
  topLeft: { readonly x: number; readonly y: number },
): FigDesignNode["transform"] {
  const currentAngle = extractRotationDeg(node.transform);
  const radians = (currentAngle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfW = node.size.x / 2;
  const halfH = node.size.y / 2;
  const newCx = topLeft.x + halfW;
  const newCy = topLeft.y + halfH;
  return {
    m00: cos,
    m01: -sin,
    m02: newCx - cos * halfW + sin * halfH,
    m10: sin,
    m11: cos,
    m12: newCy - sin * halfW - cos * halfH,
  };
}

/** Renders the alignment row from Figma's Position panel, scoped to the parent frame. */
export function AlignmentSection({ node, target, dispatch }: AlignmentSectionProps) {
  const { activePage } = useFigEditor();

  const parent = useMemo<FigDesignNode | undefined>(() => {
    if (!activePage) {
      return undefined;
    }
    return findParentNode(activePage.children, node.id);
  }, [activePage, node.id]);

  const handleAlign = useCallback(
    (axis: AlignmentAxis, position: AlignmentPosition) => {
      if (!parent) {
        return;
      }
      dispatch(createPropertyPrimaryUpdateAction({
        target,
        updater: (n) => {
          const currentTopLeft = computePreRotationTopLeft(n.transform, n.size.x, n.size.y);
          const nextTopLeft = computeAlignedTopLeft({
            axis,
            position,
            current: currentTopLeft,
            nodeSize: n.size,
            parentSize: parent.size,
          });
          return { ...n, transform: rebuildTransformFromTopLeft(n, nextTopLeft) };
        },
      }));
    },
    [dispatch, target, parent],
  );

  return <AlignmentControls onAlign={handleAlign} disabled={!parent} />;
}
