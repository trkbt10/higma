/**
 * @file Serialize a `SwiftView` tree to Swift source.
 *
 * One pass, no string concatenation outside `SwiftEscape`. Indentation is
 * driven by the structural depth of the tree — every modifier, stack
 * argument, and child view starts on its own line at depth + 1, so the
 * output reads like hand-written SwiftUI:
 *
 *   VStack(alignment: .leading, spacing: 8) {
 *     Text("Hello")
 *       .font(.system(size: 16))
 *     Color.blue
 *       .frame(width: 320, height: 44)
 *   }
 *
 * Numbers print as Swift integer literals when they have no fractional
 * part (`.frame(width: 320)`) and as decimals otherwise (`.opacity(0.5)`).
 * Producing `320.0` for an integer would be valid Swift but visually
 * clutters the output, and SwiftUI's `CGFloat` parameters accept either
 * form so there is no fidelity cost.
 */
import type { Modifier, SwiftCallArg, SwiftExpr, SwiftView } from "./types";

const INDENT = "  ";

/** Print a SwiftView tree as Swift source (no trailing newline). */
export function serialize(view: SwiftView, depth: number = 0): string {
  return printView(view, depth);
}

function printView(view: SwiftView, depth: number): string {
  if (view.kind === "leaf") {
    return printLeaf(view.expr, view.modifiers, depth);
  }
  return printStack(view, depth);
}

function printLeaf(expr: SwiftExpr, modifiers: readonly Modifier[], depth: number): string {
  const head = printExpr(expr, depth);
  return `${head}${printModifiers(modifiers, depth)}`;
}

function printStack(view: Extract<SwiftView, { kind: "stack" }>, depth: number): string {
  const head = stackHead(view.stack, view.alignment, view.spacing);
  if (view.children.length === 0) {
    return `${head} { }${printModifiers(view.modifiers, depth)}`;
  }
  const open = `${head} {`;
  const childIndent = INDENT.repeat(depth + 1);
  const childLines = view.children.map((child) => `${childIndent}${printView(child, depth + 1)}`);
  const close = `${INDENT.repeat(depth)}}`;
  return [open, ...childLines, close].join("\n") + printModifiers(view.modifiers, depth);
}

function stackHead(
  stack: "HStack" | "VStack" | "ZStack",
  alignment: string | undefined,
  spacing: number | undefined,
): string {
  const args: string[] = [];
  if (alignment !== undefined) {
    args.push(`alignment: .${alignment}`);
  }
  if (spacing !== undefined && stack !== "ZStack") {
    args.push(`spacing: ${printNumber(spacing)}`);
  }
  if (args.length === 0) {
    return stack;
  }
  return `${stack}(${args.join(", ")})`;
}

function printModifiers(modifiers: readonly Modifier[], depth: number): string {
  if (modifiers.length === 0) {
    return "";
  }
  const indent = INDENT.repeat(depth + 1);
  return modifiers
    .map((mod) => `\n${indent}.${mod.name}(${printArgs(mod.args, depth + 1)})`)
    .join("");
}

function printExpr(expr: SwiftExpr, depth: number): string {
  switch (expr.kind) {
    case "number":
      return printNumber(expr.value);
    case "string":
      return swiftStringLiteral(expr.value);
    case "bool":
      return expr.value ? "true" : "false";
    case "ident":
      return expr.value;
    case "member":
      return `.${expr.value}`;
    case "call":
      return `${expr.callee}(${printArgs(expr.args, depth)})`;
    case "array":
      return `[${expr.elements.map((e) => printExpr(e, depth)).join(", ")}]`;
    case "view":
      // Print the embedded view inline. The view may carry a modifier
      // chain (e.g. `Rectangle().stroke(Color.black, lineWidth: 2)`)
      // which `printView` already concatenates as `.modifier(...)`
      // suffixes — exactly what an argument-position view-expression
      // looks like in source.
      return printView(expr.view, depth);
  }
}

function printArgs(args: readonly SwiftCallArg[], depth: number): string {
  if (args.length === 0) {
    return "";
  }
  return args.map((a) => printArg(a, depth)).join(", ");
}

function printArg(arg: SwiftCallArg, depth: number): string {
  const value = printExpr(arg.value, depth);
  if (arg.name === undefined) {
    return value;
  }
  return `${arg.name}: ${value}`;
}

/**
 * Print a Swift number literal. Integers go without a decimal (`320`)
 * and finite non-integers print with up to six significant digits
 * trimmed of trailing zeroes (`0.5`, `1.333333`). Non-finite values
 * are not representable in SwiftUI numeric inputs and throw.
 */
export function printNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`fig-to-swiftui: cannot serialize non-finite number ${String(value)}`);
  }
  if (Number.isInteger(value)) {
    return value.toString(10);
  }
  return trimDecimalZeroes(value.toFixed(6));
}

function trimDecimalZeroes(s: string): string {
  if (!s.includes(".")) {
    return s;
  }
  const trimmed = s.replace(/0+$/u, "");
  return trimmed.endsWith(".") ? `${trimmed}0` : trimmed;
}

/**
 * Escape a JS string into a Swift string literal. Handles the quoting
 * that Swift requires (`\\`, `\"`, `\n`, `\r`, `\t`, plus generic
 * `\u{XXXX}` for non-printable control chars). Any character outside
 * those rules passes through unchanged so multi-byte UTF-8 source —
 * Japanese, emoji, etc. — round-trips byte-for-byte.
 */
export function swiftStringLiteral(value: string): string {
  const escaped: string[] = [];
  for (const ch of value) {
    escaped.push(escapeChar(ch));
  }
  return `"${escaped.join("")}"`;
}

function escapeChar(ch: string): string {
  switch (ch) {
    case "\\":
      return "\\\\";
    case '"':
      return '\\"';
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case "\t":
      return "\\t";
    case "\0":
      return "\\0";
    default: {
      const code = ch.codePointAt(0);
      if (code === undefined) {
        throw new Error("fig-to-swiftui: empty char in string literal");
      }
      if (code < 0x20) {
        return `\\u{${code.toString(16)}}`;
      }
      return ch;
    }
  }
}
