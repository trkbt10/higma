/**
 * @file Builder helpers for the SwiftUI view tree.
 *
 * Each helper returns a frozen value-typed node so callers compose by
 * passing references rather than mutating shared state. Modifiers are
 * appended through `withModifier` (single) and `withModifiers` (batch);
 * the originals are never mutated.
 */
import type {
  Modifier,
  StackKind,
  SwiftAlignment,
  SwiftCallArg,
  SwiftExpr,
  SwiftLeaf,
  SwiftStack,
  SwiftView,
} from "./types";

/** Build a Swift number literal expression. */
export function num(value: number): SwiftExpr {
  return { kind: "number", value };
}

/** Build a Swift string literal expression — escaping is handled at serialize time. */
export function str(value: string): SwiftExpr {
  return { kind: "string", value };
}

/** Build a Swift boolean literal expression. */
export function bool(value: boolean): SwiftExpr {
  return { kind: "bool", value };
}

/** Build a Swift identifier reference (e.g. variable, type name). */
export function ident(value: string): SwiftExpr {
  return { kind: "ident", value };
}

/**
 * Build a member-access reference such as `.leading` or `.red`.
 *
 * Callers pass the bare member name (`"leading"`, `"red"`, `"system"`); the
 * serializer prepends the dot. SwiftUI's leading-dot type inference is the
 * common case for stack alignments and `Color` literals, so the IR preserves
 * the typed shape rather than encoding the dot inside a string.
 */
export function member(value: string): SwiftExpr {
  return { kind: "member", value };
}

/** Build a Swift call expression (e.g. `Color(red: 0.5, green: 0.5, blue: 0.5)`). */
export function call(callee: string, args: readonly SwiftCallArg[]): SwiftExpr {
  return { kind: "call", callee, args };
}

/** Build a Swift array literal (`[1, 2, 3]`). */
export function array(elements: readonly SwiftExpr[]): SwiftExpr {
  return { kind: "array", elements };
}

/**
 * Wrap a SwiftView as a SwiftExpr so a modifier-chained view (e.g.
 * `Rectangle().stroke(Color.black, lineWidth: 2)`) can appear inside
 * a modifier argument such as `.overlay(...)` while preserving the
 * structural IR — the serializer prints the view (with its modifier
 * chain) inline.
 */
export function viewExpr(view: SwiftView): SwiftExpr {
  return { kind: "view", view };
}

/** Build a positional argument. */
export function arg(value: SwiftExpr): SwiftCallArg {
  return { value };
}

/** Build a named argument (`width: 320`). */
export function namedArg(name: string, value: SwiftExpr): SwiftCallArg {
  return { name, value };
}

/** Build a modifier (`.frame(width: 320)`). */
export function modifier(name: string, args: readonly SwiftCallArg[]): Modifier {
  return { name, args };
}

export type StackOptions = {
  readonly stack: StackKind;
  readonly alignment?: SwiftAlignment;
  readonly spacing?: number;
  readonly modifiers?: readonly Modifier[];
};

/** Build a stack node (HStack / VStack / ZStack). */
export function stack(
  options: StackOptions,
  children: readonly SwiftView[],
): SwiftStack {
  return {
    kind: "stack",
    stack: options.stack,
    alignment: options.alignment,
    spacing: options.spacing,
    children,
    modifiers: options.modifiers ?? [],
  };
}

/** Build a leaf view (single SwiftUI primitive call). */
export function leaf(expr: SwiftExpr, modifiers: readonly Modifier[] = []): SwiftLeaf {
  return { kind: "leaf", expr, modifiers };
}

/** Append one modifier to an existing view, returning a new view. */
export function withModifier(view: SwiftView, mod: Modifier): SwiftView {
  return appendModifiers(view, [mod]);
}

/** Append a batch of modifiers to an existing view, returning a new view. */
export function withModifiers(view: SwiftView, mods: readonly Modifier[]): SwiftView {
  if (mods.length === 0) {
    return view;
  }
  return appendModifiers(view, mods);
}

function appendModifiers(view: SwiftView, mods: readonly Modifier[]): SwiftView {
  if (view.kind === "stack") {
    return { ...view, modifiers: [...view.modifiers, ...mods] };
  }
  return { ...view, modifiers: [...view.modifiers, ...mods] };
}
