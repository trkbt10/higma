/**
 * @file Typed SwiftUI view tree.
 *
 * Every emit step in fig-to-swiftui produces a `SwiftView` value, never
 * a raw Swift source string. The single serializer in `serialize.ts`
 * eventually prints Swift, funnelling every Figma-author string
 * (TEXT characters, layer names, font family overrides) through
 * Swift-string escaping at the boundary. Mixing typed nodes and raw
 * strings would put each call site back in charge of its own escaping;
 * the typed tree makes that impossible.
 *
 * The shape is deliberately narrow — a SwiftUI view body is either
 *
 *   - a stack (`HStack` / `VStack` / `ZStack`) wrapping children, or
 *   - a leaf primitive (`Text`, `Color`, `Rectangle`, `Image`, `Spacer`),
 *
 * each carrying a list of `Modifier` values applied in source order
 * (`.frame(...).padding(...).background(...)`).
 *
 * Argument values use the typed `SwiftExpr` union so the serializer
 * can pretty-print numbers, named arguments, and references without
 * letting any caller leak a raw Swift literal into the output.
 */

/** Stack alignment value for HStack / VStack / ZStack `alignment:` parameters. */
export type SwiftAlignment =
  | "leading"
  | "trailing"
  | "top"
  | "bottom"
  | "center"
  | "topLeading"
  | "topTrailing"
  | "bottomLeading"
  | "bottomTrailing";

/** Numeric / named-argument expression printable as a Swift fragment. */
export type SwiftExpr =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "ident"; readonly value: string }
  | { readonly kind: "member"; readonly value: string }
  | { readonly kind: "call"; readonly callee: string; readonly args: readonly SwiftCallArg[] }
  | { readonly kind: "array"; readonly elements: readonly SwiftExpr[] }
  /**
   * A view value used as an expression — the carrier for modifier-chained
   * shapes that appear inside a modifier argument, e.g.
   * `.overlay(Rectangle().stroke(Color.black, lineWidth: 2))`. The serializer
   * prints `printView(view)` so the chain prints inline; the parser
   * accepts a leaf-or-stack expression with trailing `.method(...)` calls
   * inside an argument context.
   */
  | { readonly kind: "view"; readonly view: SwiftView };

/** Named or positional argument inside a Swift call expression. */
export type SwiftCallArg = {
  readonly name?: string;
  readonly value: SwiftExpr;
};

/**
 * One modifier applied to a view, e.g. `.frame(width: 320, height: 44)`.
 *
 * The serializer prints them in array order, so the array order is the
 * SwiftUI evaluation order. SwiftUI modifiers are non-commutative —
 * `.padding(8).background(Color.red)` paints red around the padded
 * region, while `.background(Color.red).padding(8)` paints red only
 * over the inner content. Callers must respect that.
 */
export type Modifier = {
  readonly name: string;
  readonly args: readonly SwiftCallArg[];
};

/** Stack container — HStack, VStack, or ZStack. */
export type StackKind = "HStack" | "VStack" | "ZStack";

/** Stack node — a SwiftUI stack and its child views. */
export type SwiftStack = {
  readonly kind: "stack";
  readonly stack: StackKind;
  readonly alignment?: SwiftAlignment;
  /** HStack / VStack only — ZStack ignores `spacing:`. */
  readonly spacing?: number;
  readonly children: readonly SwiftView[];
  readonly modifiers: readonly Modifier[];
};

/** Leaf node — a single SwiftUI primitive (Text / Color / Rectangle / Image / Spacer). */
export type SwiftLeaf = {
  readonly kind: "leaf";
  /** SwiftUI view constructor expression, e.g. `Text("Hello")` or `Color.red`. */
  readonly expr: SwiftExpr;
  readonly modifiers: readonly Modifier[];
};

export type SwiftView = SwiftStack | SwiftLeaf;
