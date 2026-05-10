/**
 * @file Inverse of `serialize` — parse a SwiftUI body fragment back into
 * the typed `SwiftView` IR.
 *
 * Scope: the parser only accepts the exact subset of Swift that fig-to-swiftui
 * emits — stacks (`HStack` / `VStack` / `ZStack`) with `alignment:` /
 * `spacing:` arguments, leaf calls (`Text(...)`, `Color(...)`, `Color.red`,
 * `Rectangle()`, `Ellipse()`, `Spacer()`), nested call expressions
 * (`.system(size: 16, weight: .bold)`, `Color(red: …)`), modifier chains
 * (`.frame(width: 320)`), and the literal forms `printNumber` /
 * `swiftStringLiteral` produce. Anything outside this surface throws.
 *
 * Why this exists: the verification tooling (analogue of web-to-fig's
 * `Web → IR → Fig → IR` round-trip) needs to recover an IR from the
 * emitter's text output so a case spec can assert structural equivalence
 * with the input FigNode-derived IR. Asserting only on the serialized
 * string would lock tests to the exact byte layout (whitespace, modifier
 * order, formatting choices) — a parse-back lets the contract be "the
 * round-trip preserves the typed tree", not "the formatter never changes".
 *
 * Intentionally hand-rolled (no parser generator): the grammar is small
 * enough to fit in one file and there is no benefit to depending on a
 * third-party Swift parser whose surface dwarfs what we accept.
 */
import type {
  Modifier,
  StackKind,
  SwiftAlignment,
  SwiftCallArg,
  SwiftExpr,
  SwiftView,
} from "./types";

const STACK_NAMES: ReadonlySet<StackKind> = new Set(["HStack", "VStack", "ZStack"]);

const ALIGNMENT_NAMES: ReadonlySet<SwiftAlignment> = new Set([
  "leading",
  "trailing",
  "top",
  "bottom",
  "center",
  "topLeading",
  "topTrailing",
  "bottomLeading",
  "bottomTrailing",
]);

/**
 * Error thrown by `parseView` when the input falls outside the
 * accepted Swift subset. Carries a small slice of the source around
 * the failure point so the message points at the offending byte
 * rather than just the line number.
 */
class ParseError extends Error {
  constructor(message: string, source: string, position: number) {
    const head = source.slice(Math.max(0, position - 20), position);
    const tail = source.slice(position, position + 20);
    super(`fig-to-swiftui parse: ${message} at ${position}: …${head}|${tail}…`);
    this.name = "ParseError";
  }
}

type Cursor = { source: string; pos: number };

/**
 * Parse a single SwiftUI body fragment (one top-level view) and return
 * the `SwiftView` it represents. Trailing whitespace is tolerated;
 * trailing tokens are not.
 */
export function parseView(source: string): SwiftView {
  const cursor: Cursor = { source, pos: 0 };
  skipWhitespace(cursor);
  const view = readView(cursor);
  skipWhitespace(cursor);
  if (cursor.pos !== cursor.source.length) {
    throw new ParseError("trailing input after view", cursor.source, cursor.pos);
  }
  return view;
}

function readView(cursor: Cursor): SwiftView {
  // Look ahead at the first identifier — stack vs leaf is decided by name.
  const checkpoint = cursor.pos;
  const ident = peekIdentifier(cursor);
  if (ident && STACK_NAMES.has(ident as StackKind)) {
    return readStack(cursor, ident as StackKind);
  }
  cursor.pos = checkpoint;
  return readLeaf(cursor);
}

function readStack(cursor: Cursor, stackName: StackKind): SwiftView {
  // Consume the bare identifier (already validated).
  consumeIdentifier(cursor, stackName);
  const head = readStackHeadArgs(cursor);
  skipWhitespace(cursor);
  // The body is `{ ... }`; an empty stack prints `Stack { }` per the
  // serializer, so we must accept an immediate `}`.
  expectChar(cursor, "{");
  skipWhitespace(cursor);
  const children: SwiftView[] = [];
  while (peekChar(cursor) !== "}") {
    children.push(readView(cursor));
    skipWhitespace(cursor);
  }
  expectChar(cursor, "}");
  const modifiers = readModifiers(cursor);
  return {
    kind: "stack",
    stack: stackName,
    alignment: head.alignment,
    spacing: head.spacing,
    children,
    modifiers,
  };
}

function readStackHeadArgs(cursor: Cursor): {
  readonly alignment?: SwiftAlignment;
  readonly spacing?: number;
} {
  skipWhitespace(cursor);
  if (peekChar(cursor) !== "(") {
    return {};
  }
  expectChar(cursor, "(");
  const args = readCallArgs(cursor);
  expectChar(cursor, ")");
  const out: { alignment?: SwiftAlignment; spacing?: number } = {};
  for (const arg of args) {
    if (arg.name === "alignment") {
      out.alignment = readAlignmentFromExpr(arg.value, cursor);
      continue;
    }
    if (arg.name === "spacing") {
      out.spacing = readNumberFromExpr(arg.value, cursor);
      continue;
    }
    throw new ParseError(`unknown stack argument "${arg.name ?? "<positional>"}"`, cursor.source, cursor.pos);
  }
  return out;
}

function readAlignmentFromExpr(expr: SwiftExpr, cursor: Cursor): SwiftAlignment {
  if (expr.kind !== "member") {
    throw new ParseError("alignment must be a `.foo` member reference", cursor.source, cursor.pos);
  }
  if (!ALIGNMENT_NAMES.has(expr.value as SwiftAlignment)) {
    throw new ParseError(`unknown alignment "${expr.value}"`, cursor.source, cursor.pos);
  }
  return expr.value as SwiftAlignment;
}

function readNumberFromExpr(expr: SwiftExpr, cursor: Cursor): number {
  if (expr.kind !== "number") {
    throw new ParseError("expected numeric literal", cursor.source, cursor.pos);
  }
  return expr.value;
}

function readLeaf(cursor: Cursor): SwiftView {
  const expr = readExpr(cursor);
  const modifiers = readModifiers(cursor);
  return { kind: "leaf", expr, modifiers };
}

function readModifiers(cursor: Cursor): readonly Modifier[] {
  const out: Modifier[] = [];
  while (true) {
    const checkpoint = cursor.pos;
    skipWhitespace(cursor);
    if (peekChar(cursor) !== ".") {
      cursor.pos = checkpoint;
      return out;
    }
    // A modifier is `.ident(args)`. Distinguish from a `.member`
    // expression that happens to be an argument by requiring the dot
    // to be followed by an identifier and an opening paren.
    const lookahead = cursor.pos + 1;
    if (!isIdentifierStart(cursor.source.charAt(lookahead))) {
      cursor.pos = checkpoint;
      return out;
    }
    expectChar(cursor, ".");
    const name = consumeIdentifierAny(cursor);
    expectChar(cursor, "(");
    const args = readCallArgs(cursor);
    expectChar(cursor, ")");
    out.push({ name, args });
  }
}

function readExpr(cursor: Cursor): SwiftExpr {
  skipWhitespace(cursor);
  const ch = peekChar(cursor);
  if (ch === '"') {
    return { kind: "string", value: readStringLiteral(cursor) };
  }
  if (ch === "-" || isDigit(ch)) {
    return { kind: "number", value: readNumberLiteral(cursor) };
  }
  if (ch === "[") {
    return readArrayLiteral(cursor);
  }
  if (ch === ".") {
    expectChar(cursor, ".");
    // Dotted call: `.system(size: 16, weight: .bold)`. The leading dot
    // means leading-dot type inference; we keep it on the call's
    // callee so `serialize` round-trips it.
    const ident = consumeIdentifierAny(cursor);
    if (peekChar(cursor) === "(") {
      expectChar(cursor, "(");
      const args = readCallArgs(cursor);
      expectChar(cursor, ")");
      return { kind: "call", callee: `.${ident}`, args };
    }
    return { kind: "member", value: ident };
  }
  if (isIdentifierStart(ch)) {
    return readIdentifierExpr(cursor);
  }
  throw new ParseError(`unexpected character "${ch}"`, cursor.source, cursor.pos);
}

function readArrayLiteral(cursor: Cursor): SwiftExpr {
  expectChar(cursor, "[");
  skipWhitespace(cursor);
  const elements: SwiftExpr[] = [];
  if (peekChar(cursor) === "]") {
    cursor.pos = cursor.pos + 1;
    return { kind: "array", elements };
  }
  while (true) {
    elements.push(readExpr(cursor));
    skipWhitespace(cursor);
    if (peekChar(cursor) === ",") {
      cursor.pos = cursor.pos + 1;
      skipWhitespace(cursor);
      continue;
    }
    expectChar(cursor, "]");
    return { kind: "array", elements };
  }
}

function readIdentifierExpr(cursor: Cursor): SwiftExpr {
  const ident = consumeIdentifierAny(cursor);
  if (ident === "true") {
    return { kind: "bool", value: true };
  }
  if (ident === "false") {
    return { kind: "bool", value: false };
  }
  // Trailing `()` is `Spacer()` / `Rectangle()` etc. We model the
  // builder's `ident("Spacer()")` — the IR carries the string with
  // parens so the serializer round-trips it as-is.
  if (peekChar(cursor) === "(") {
    expectChar(cursor, "(");
    const args = readCallArgs(cursor);
    expectChar(cursor, ")");
    if (args.length === 0) {
      // Match the emitter: `Spacer()` / `Rectangle()` / `Ellipse()`
      // come out of the builder as `ident("Spacer()")`, not as a
      // zero-arg call.
      return { kind: "ident", value: `${ident}()` };
    }
    return { kind: "call", callee: ident, args };
  }
  // Bare identifier path: `Color.blue` / `Color.clear` etc. The
  // emitter rarely produces these (it prefers `member("blue")` for the
  // dotted form), but a hand-written test fixture might.
  if (peekChar(cursor) === ".") {
    expectChar(cursor, ".");
    const tail = consumeIdentifierAny(cursor);
    return { kind: "ident", value: `${ident}.${tail}` };
  }
  return { kind: "ident", value: ident };
}

function readCallArgs(cursor: Cursor): readonly SwiftCallArg[] {
  const out: SwiftCallArg[] = [];
  skipWhitespace(cursor);
  if (peekChar(cursor) === ")") {
    return out;
  }
  while (true) {
    out.push(readCallArg(cursor));
    skipWhitespace(cursor);
    if (peekChar(cursor) === ",") {
      cursor.pos = cursor.pos + 1;
      skipWhitespace(cursor);
      continue;
    }
    return out;
  }
}

function readCallArg(cursor: Cursor): SwiftCallArg {
  skipWhitespace(cursor);
  const checkpoint = cursor.pos;
  // Try to read an `ident:` label.
  if (isIdentifierStart(peekChar(cursor))) {
    const ident = consumeIdentifierAny(cursor);
    skipWhitespace(cursor);
    if (peekChar(cursor) === ":") {
      cursor.pos = cursor.pos + 1;
      skipWhitespace(cursor);
      const value = readArgValue(cursor);
      return { name: ident, value };
    }
    // Not a label — rewind and parse as a positional expression.
    cursor.pos = checkpoint;
  }
  const value = readArgValue(cursor);
  return { value };
}

/**
 * Read an argument-position value, including any trailing modifier
 * chain. SwiftUI freely composes views inline, so an argument like
 * `.overlay(Rectangle().stroke(Color.black, lineWidth: 2))` carries a
 * full view (a leaf with modifiers) at the argument site. The IR
 * captures that as a `view`-kind expression so the structural round-trip
 * preserves the modifier chain.
 *
 * Whether the trailing chain is structurally meaningful depends on the
 * receiver — modifiers attach to views, not to plain literals — so we
 * only wrap in `view` when at least one modifier was consumed. Bare
 * expressions stay in their `SwiftExpr` shape.
 */
function readArgValue(cursor: Cursor): SwiftExpr {
  const expr = readExpr(cursor);
  const modifiers = readModifiers(cursor);
  if (modifiers.length === 0) {
    return expr;
  }
  return {
    kind: "view",
    view: { kind: "leaf", expr, modifiers },
  };
}

function readNumberLiteral(cursor: Cursor): number {
  const start = cursor.pos;
  if (peekChar(cursor) === "-") {
    cursor.pos = cursor.pos + 1;
  }
  while (isDigit(peekChar(cursor))) {
    cursor.pos = cursor.pos + 1;
  }
  if (peekChar(cursor) === ".") {
    cursor.pos = cursor.pos + 1;
    while (isDigit(peekChar(cursor))) {
      cursor.pos = cursor.pos + 1;
    }
  }
  const slice = cursor.source.slice(start, cursor.pos);
  const n = Number(slice);
  if (!Number.isFinite(n)) {
    throw new ParseError(`invalid number "${slice}"`, cursor.source, start);
  }
  return n;
}

function readStringLiteral(cursor: Cursor): string {
  expectChar(cursor, '"');
  const out: string[] = [];
  while (true) {
    const ch = cursor.source.charAt(cursor.pos);
    if (ch === "") {
      throw new ParseError("unterminated string literal", cursor.source, cursor.pos);
    }
    if (ch === '"') {
      cursor.pos = cursor.pos + 1;
      return out.join("");
    }
    if (ch === "\\") {
      cursor.pos = cursor.pos + 1;
      const next = cursor.source.charAt(cursor.pos);
      if (next === "u" && cursor.source.charAt(cursor.pos + 1) === "{") {
        out.push(readUnicodeEscape(cursor));
        continue;
      }
      out.push(readSimpleEscape(cursor, next));
      continue;
    }
    out.push(ch);
    cursor.pos = cursor.pos + 1;
  }
}

function readSimpleEscape(cursor: Cursor, ch: string): string {
  cursor.pos = cursor.pos + 1;
  switch (ch) {
    case "\\":
      return "\\";
    case '"':
      return '"';
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "0":
      return "\0";
    default:
      throw new ParseError(`unknown escape sequence "\\${ch}"`, cursor.source, cursor.pos);
  }
}

function readUnicodeEscape(cursor: Cursor): string {
  // Already consumed `\`; now consume `u{HEX}`.
  cursor.pos = cursor.pos + 2; // skip `u{`
  const start = cursor.pos;
  while (cursor.source.charAt(cursor.pos) !== "}") {
    if (cursor.pos >= cursor.source.length) {
      throw new ParseError("unterminated unicode escape", cursor.source, start);
    }
    cursor.pos = cursor.pos + 1;
  }
  const hex = cursor.source.slice(start, cursor.pos);
  cursor.pos = cursor.pos + 1; // skip `}`
  const code = Number.parseInt(hex, 16);
  if (!Number.isFinite(code)) {
    throw new ParseError(`invalid unicode escape "${hex}"`, cursor.source, start);
  }
  return String.fromCodePoint(code);
}

function consumeIdentifier(cursor: Cursor, expected: string): void {
  for (const ch of expected) {
    if (cursor.source.charAt(cursor.pos) !== ch) {
      throw new ParseError(`expected "${expected}"`, cursor.source, cursor.pos);
    }
    cursor.pos = cursor.pos + 1;
  }
}

function consumeIdentifierAny(cursor: Cursor): string {
  const start = cursor.pos;
  if (!isIdentifierStart(cursor.source.charAt(cursor.pos))) {
    throw new ParseError("expected identifier", cursor.source, cursor.pos);
  }
  cursor.pos = cursor.pos + 1;
  while (isIdentifierPart(cursor.source.charAt(cursor.pos))) {
    cursor.pos = cursor.pos + 1;
  }
  return cursor.source.slice(start, cursor.pos);
}

function peekIdentifier(cursor: Cursor): string | undefined {
  const start = cursor.pos;
  if (!isIdentifierStart(cursor.source.charAt(start))) {
    return undefined;
  }
  const probe = { source: cursor.source, pos: start };
  return consumeIdentifierAny(probe);
}

function expectChar(cursor: Cursor, ch: string): void {
  if (cursor.source.charAt(cursor.pos) !== ch) {
    throw new ParseError(`expected "${ch}"`, cursor.source, cursor.pos);
  }
  cursor.pos = cursor.pos + 1;
}

function peekChar(cursor: Cursor): string {
  return cursor.source.charAt(cursor.pos);
}

function skipWhitespace(cursor: Cursor): void {
  while (true) {
    const ch = cursor.source.charAt(cursor.pos);
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      cursor.pos = cursor.pos + 1;
      continue;
    }
    return;
  }
}

function isIdentifierStart(ch: string): boolean {
  if (ch === "") {
    return false;
  }
  if (ch === "_") {
    return true;
  }
  return /^[A-Za-z]$/.test(ch);
}

function isIdentifierPart(ch: string): boolean {
  if (ch === "") {
    return false;
  }
  return isIdentifierStart(ch) || isDigit(ch);
}

function isDigit(ch: string): boolean {
  if (ch === "") {
    return false;
  }
  return ch >= "0" && ch <= "9";
}

export { ParseError };
