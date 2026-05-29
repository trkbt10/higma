/**
 * @file Shared container-layout decision — the single source of truth
 * both the JSX emitter (`render/jsx.ts`) and the liquid sizing
 * translation (`layout/liquid.ts`) consume.
 *
 * The liquid pass re-expresses a container's children as percentages of
 * the container's *content box*. That percentage is only correct when
 * the denominator (content width = node size − padding) and the
 * flow/absolute classification of each child match **exactly** what the
 * emitter rendered. The two decisions are derived here once so the two
 * callers can never drift: a divergence would make the liquid render
 * disagree with the fixed render at the authored width, breaking the
 * "design width ⇒ identical output" invariant.
 *
 * `resolveContainerLayout` reproduces the precise child set the emitter
 * lays out:
 *
 *   1. `absorbBackgroundDecoration` lifts a full-bleed first child into
 *      the parent's `background*` — that child is dropped from the flow,
 *      and its removal can unlock a different inference (2-child overlap
 *      → 1-child inset).
 *   2. The remaining visible children (minus the absorbed one) are the
 *      `baseChildren` fed to `inferLayout`.
 *   3. `inferLayout` yields the flex/inset descriptor (with its numeric
 *      padding + alignment) that decides the container's own layout.
 *
 * Visibility predicates (`isRendered` / `isFigmaMaskNode`) live here too
 * because "which children participate" is a layout concern shared by the
 * emitter and the liquid pass, not a render-only detail.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import type { ParentLayout, StyleInputs } from "../style/style";
import { parentLayoutOf } from "../style/style";
import { absorbBackgroundDecoration } from "../style/decoration";
import type { InferenceResult } from "./infer-layout";
import { inferLayout } from "./infer-layout";

const NON_RENDERED_TYPES: ReadonlySet<string> = new Set([
  "SLICE",
]);

/**
 * Figma mask-children carry `mask: true`. They don't paint themselves —
 * they only clip their following siblings — so they never appear in the
 * rendered child list (the clip is applied separately by the emitter).
 */
export function isFigmaMaskNode(node: FigNode): boolean {
  return node.mask === true;
}

/**
 * Does this node produce ink in the emitted output? Hidden layers,
 * non-rendered node types (SLICE), and Figma mask vectors are excluded.
 * Shared so the liquid pass measures the exact same child set the
 * emitter lays out.
 */
export function isRendered(node: FigNode): boolean {
  if (node.visible === false) {
    return false;
  }
  if (NON_RENDERED_TYPES.has(node.type.name)) {
    return false;
  }
  if (isFigmaMaskNode(node)) {
    return false;
  }
  return true;
}

/**
 * The layout regime a container imposes on its children, considering
 * both explicit auto-layout (`stackMode`) and inferred stacks. An
 * inferred `inset` flows its single child under flex semantics (CSS
 * `padding` alone would leave a `position: absolute` child glued to the
 * origin), matching the emitter.
 */
export function effectiveChildParentLayout(node: FigNode, inferred: InferenceResult): ParentLayout {
  if (inferred?.direction === "row") {
    return "flex-row";
  }
  if (inferred?.direction === "column") {
    return "flex-column";
  }
  if (inferred?.direction === "inset") {
    return "flex-row";
  }
  return parentLayoutOf(node);
}

export type ResolvedContainerLayout = {
  /** Background-decoration absorption result (absorbed child + lifted style). */
  readonly absorbed: ReturnType<typeof absorbBackgroundDecoration>;
  /** Visible children minus the absorbed background, in source order. */
  readonly baseChildren: readonly FigNode[];
  /** The flex/inset descriptor inferred for the container, or undefined. */
  readonly inferred: InferenceResult;
};

export type ResolveContainerLayoutDeps = {
  /** Reparent/cluster-aware child reader (e.g. `childrenOfEmitNode`). */
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
  /** Style inputs `absorbBackgroundDecoration` needs (token index, image resolver, childrenOf). */
  readonly styleInputs: StyleInputs;
};

/**
 * Resolve the layout decision for `node`'s children. Both the emitter
 * and the liquid pass call this with the same `childrenOf` reader so the
 * `baseChildren` set and `inferred` descriptor are identical.
 */
export function resolveContainerLayout(
  node: FigNode,
  deps: ResolveContainerLayoutDeps,
): ResolvedContainerLayout {
  const absorbed = absorbBackgroundDecoration(node, deps.styleInputs);
  const rawChildren = deps.childrenOf(node);
  const baseChildren = rawChildren
    .filter(isRendered)
    .filter((c) => c !== absorbed.absorbed);
  const inferred = inferLayout(node, baseChildren);
  return { absorbed, baseChildren, inferred };
}
