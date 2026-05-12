/**
 * @file Unit specs for the Path emit helpers.
 *
 * Focus: the fill-rule selector. fig's vector encoding packs
 * hollow Win98 chrome glyphs (maximize box, menu underline
 * bracket) as a single VECTOR carrying two subpaths — an outer
 * loop and an inner loop. SwiftUI's default fill rule is
 * non-zero, which would paint both loops as a solid blob. The
 * emitter must switch to even-odd whenever the path body
 * contains more than one `move` command.
 */
import { countSubpaths, type PathCommand } from "@higma-primitives/path";
import { ident, type SwiftExpr } from "../swift-tree";
import { buildFillArgs } from "./geometry";

/**
 * Stringify a `SwiftExpr` for assertions. The full `serialize`
 * exported by swift-tree is `SwiftView`-shaped; for expression
 * comparisons we look at the `kind`-specific text payload
 * directly. Only the shapes this spec produces are handled —
 * adding new exprs to the test means extending this helper.
 */
function exprText(expr: SwiftExpr): string {
  if (expr.kind === "ident") {
    return expr.value;
  }
  throw new Error(`exprText: unsupported expr kind "${expr.kind}"`);
}

function makePath(moves: number): readonly PathCommand[] {
  // Emit `moves` distinct M commands with a trivial closing
  // line so the resulting path is at least syntactically valid.
  // Exact coordinates are irrelevant for the fill-rule decision —
  // only the count of `M` commands drives `countSubpaths`.
  const out: PathCommand[] = [];
  for (let i = 0; i < moves; i += 1) {
    out.push({ type: "M", x: i * 10, y: 0 });
    out.push({ type: "L", x: i * 10 + 5, y: 5 });
    out.push({ type: "Z" });
  }
  return out;
}

describe("countSubpaths", () => {
  it("returns 0 for an empty command list", () => {
    expect(countSubpaths([])).toBe(0);
  });

  it("returns 1 for a single subpath", () => {
    expect(countSubpaths(makePath(1))).toBe(1);
  });

  it("returns 2 for two subpaths (the hollow-square case)", () => {
    expect(countSubpaths(makePath(2))).toBe(2);
  });

  it("counts every `M` command, regardless of intervening lines/curves", () => {
    const commands: readonly PathCommand[] = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 1, y: 1 },
      { type: "C", x: 2, y: 2, x1: 1.5, y1: 0.5, x2: 1.5, y2: 2.5 },
      { type: "M", x: 3, y: 0 },
      { type: "L", x: 4, y: 1 },
      { type: "Z" },
      { type: "M", x: 5, y: 0 },
    ];
    expect(countSubpaths(commands)).toBe(3);
  });

  it("does not count L / C / Q / A / Z as new subpaths", () => {
    const commands: readonly PathCommand[] = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 1, y: 0 },
      { type: "C", x: 2, y: 0, x1: 1.5, y1: 0, x2: 1.5, y2: 0 },
      { type: "Q", x: 3, y: 0, x1: 2.5, y1: 0 },
      { type: "Z" },
    ];
    expect(countSubpaths(commands)).toBe(1);
  });
});

describe("buildFillArgs", () => {
  const paint = ident("Color.red");

  it("emits a single positional argument for a single subpath", () => {
    const args = buildFillArgs(paint, makePath(1));
    expect(args).toHaveLength(1);
    expect(exprText(args[0]!.value)).toBe("Color.red");
    expect(args[0]!.name).toBeUndefined();
  });

  it("adds `style: FillStyle(eoFill: true)` for two or more subpaths", () => {
    const args = buildFillArgs(paint, makePath(2));
    expect(args).toHaveLength(2);
    expect(args[1]!.name).toBe("style");
    expect(exprText(args[1]!.value)).toBe("FillStyle(eoFill: true)");
  });

  it("uses non-zero default for an empty command list", () => {
    const args = buildFillArgs(paint, []);
    expect(args).toHaveLength(1);
    expect(args[0]!.name).toBeUndefined();
  });
});
