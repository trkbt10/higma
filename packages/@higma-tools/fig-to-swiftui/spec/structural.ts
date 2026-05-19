/**
 * @file Structural-equivalence routines for SwiftView trees.
 *
 * `summarize` produces a JSON-friendly snapshot of a SwiftView that:
 *
 *   - keeps every diff-relevant field (kind, stack/alignment/spacing,
 *     children, expr shape, modifier name + args)
 *   - elides nothing that affects the rendered SwiftUI surface
 *
 * Cases use it to assert `summarize(parsedTree) === summarize(tree)`
 * with a reasonable diff when the round-trip ever drifts. The
 * symmetric form lets us skip per-field manual cross-checks the way
 * web-to-fig's `summarize` does for NodeIR.
 *
 * Why a custom summary instead of `expect(parsed).toEqual(tree)`:
 * vitest's deep-equal is already structural, but a custom summary
 * gives us a single string-diff target that survives changes to the
 * underlying type shape (adding an optional field doesn't break
 * existing case snapshots as long as it's elided here).
 */
import type {
  Modifier,
  StackKind,
  SwiftCallArg,
  SwiftExpr,
  SwiftView,
} from "@higma-tools/fig-to-swiftui/swift-tree";

export type ViewSummary =
  | {
      readonly kind: "stack";
      readonly stack: StackKind;
      readonly alignment?: string;
      readonly spacing?: number;
      readonly children: readonly ViewSummary[];
      readonly modifiers: readonly ModifierSummary[];
    }
  | {
      readonly kind: "leaf";
      readonly expr: ExprSummary;
      readonly modifiers: readonly ModifierSummary[];
    };

export type ExprSummary =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "ident"; readonly value: string }
  | { readonly kind: "member"; readonly value: string }
  | { readonly kind: "call"; readonly callee: string; readonly args: readonly CallArgSummary[] }
  | { readonly kind: "array"; readonly elements: readonly ExprSummary[] }
  | { readonly kind: "view"; readonly view: ViewSummary };

export type CallArgSummary = {
  readonly name?: string;
  readonly value: ExprSummary;
};

export type ModifierSummary = {
  readonly name: string;
  readonly args: readonly CallArgSummary[];
};

/** Build a structural summary that survives optional-field additions. */
export function summarize(view: SwiftView): ViewSummary {
  if (view.kind === "stack") {
    return {
      kind: "stack",
      stack: view.stack,
      alignment: view.alignment,
      spacing: view.spacing,
      children: view.children.map(summarize),
      modifiers: view.modifiers.map(summarizeModifier),
    };
  }
  return {
    kind: "leaf",
    expr: summarizeExpr(view.expr),
    modifiers: view.modifiers.map(summarizeModifier),
  };
}

function summarizeModifier(mod: Modifier): ModifierSummary {
  return { name: mod.name, args: mod.args.map(summarizeCallArg) };
}

function summarizeCallArg(arg: SwiftCallArg): CallArgSummary {
  return { name: arg.name, value: summarizeExpr(arg.value) };
}

function summarizeExpr(expr: SwiftExpr): ExprSummary {
  switch (expr.kind) {
    case "number":
    case "string":
    case "bool":
    case "ident":
    case "member":
      return expr;
    case "call":
      return { kind: "call", callee: expr.callee, args: expr.args.map(summarizeCallArg) };
    case "array":
      return { kind: "array", elements: expr.elements.map(summarizeExpr) };
    case "view":
      return { kind: "view", view: summarize(expr.view) };
  }
}
