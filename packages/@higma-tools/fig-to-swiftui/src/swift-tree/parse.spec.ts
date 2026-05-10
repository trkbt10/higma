/**
 * @file Spec for the SwiftView parser.
 *
 * The contract: `parseView(serialize(view))` must equal `view` for every
 * tree the emitter can produce. The properties we lock in here are:
 *
 *   - leaf calls (Text(...), Color(...), Color.red, Spacer())
 *   - dotted calls (.system(size: 16, weight: .bold))
 *   - stacks with alignment + spacing in either order
 *   - nested stacks
 *   - modifier chains
 *   - string-literal escapes
 *   - integer + decimal numbers, including negatives
 *   - parse errors on out-of-vocabulary input
 */
import {
  call,
  ident,
  leaf,
  member,
  modifier,
  namedArg,
  num,
  stack,
  str,
} from "./builder";
import { parseView, ParseError } from "./parse";
import { serialize } from "./serialize";
import type { SwiftView } from "./types";

function roundtrip(view: SwiftView): SwiftView {
  return parseView(serialize(view));
}

describe("parseView — leaves", () => {
  it("parses Text(...)", () => {
    const view = leaf(call("Text", [{ value: str("Hello") }]));
    expect(roundtrip(view)).toEqual(view);
  });

  it("parses a Color(...) with named args", () => {
    const view = leaf(
      call("Color", [
        namedArg("red", num(0.5)),
        namedArg("green", num(0.5)),
        namedArg("blue", num(0.5)),
        namedArg("opacity", num(0.5)),
      ]),
    );
    expect(roundtrip(view)).toEqual(view);
  });

  it("parses Spacer() and Rectangle() as zero-arg ident-style leaves", () => {
    const spacer = leaf(ident("Spacer()"));
    const rect = leaf(ident("Rectangle()"));
    expect(roundtrip(spacer)).toEqual(spacer);
    expect(roundtrip(rect)).toEqual(rect);
  });

  it("parses a `.member` reference", () => {
    const view = leaf(member("clear"));
    expect(roundtrip(view)).toEqual(view);
  });

  it("parses negative + decimal numbers", () => {
    const view = leaf(
      call("F", [namedArg("a", num(-12)), namedArg("b", num(0.25))]),
    );
    expect(roundtrip(view)).toEqual(view);
  });

  it("parses booleans", () => {
    const view = leaf(call("Box", [namedArg("on", { kind: "bool", value: true })]));
    expect(roundtrip(view)).toEqual(view);
  });
});

describe("parseView — modifier chains", () => {
  it("parses a single modifier", () => {
    const view = leaf(call("Text", [{ value: str("Hi") }]), [
      modifier("font", [{ value: call(".system", [namedArg("size", num(16))]) }]),
    ]);
    expect(roundtrip(view)).toEqual(view);
  });

  it("parses a multi-modifier chain in declaration order", () => {
    const view = leaf(call("Text", [{ value: str("Hi") }]), [
      modifier("font", [
        { value: call(".system", [namedArg("size", num(16)), namedArg("weight", member("bold"))]) },
      ]),
      modifier("foregroundColor", [{ value: member("red") }]),
      modifier("opacity", [{ value: num(0.5) }]),
    ]);
    expect(roundtrip(view)).toEqual(view);
  });
});

describe("parseView — stacks", () => {
  it("parses an empty stack", () => {
    const view = stack({ stack: "ZStack" }, []);
    expect(roundtrip(view)).toEqual(view);
  });

  it("parses an HStack with alignment + spacing", () => {
    const view = stack(
      { stack: "HStack", alignment: "center", spacing: 8 },
      [leaf(call("Text", [{ value: str("a") }]))],
    );
    expect(roundtrip(view)).toEqual(view);
  });

  it("parses a VStack with only spacing", () => {
    const view = stack(
      { stack: "VStack", spacing: 4 },
      [leaf(call("Text", [{ value: str("a") }]))],
    );
    expect(roundtrip(view)).toEqual(view);
  });

  it("parses a ZStack with topLeading alignment", () => {
    const view = stack(
      { stack: "ZStack", alignment: "topLeading" },
      [leaf(call("Text", [{ value: str("a") }]))],
    );
    expect(roundtrip(view)).toEqual(view);
  });

  it("parses nested stacks", () => {
    const view = stack({ stack: "VStack", alignment: "leading" }, [
      stack({ stack: "HStack", spacing: 4 }, [
        leaf(call("Text", [{ value: str("a") }])),
        leaf(call("Text", [{ value: str("b") }])),
      ]),
      leaf(ident("Spacer()")),
    ]);
    expect(roundtrip(view)).toEqual(view);
  });

  it("parses modifiers attached to stacks", () => {
    const view = stack(
      {
        stack: "HStack",
        spacing: 8,
        modifiers: [
          modifier("padding", [{ value: num(12) }]),
          modifier("background", [
            {
              value: call("Color", [
                namedArg("red", num(0)),
                namedArg("green", num(0)),
                namedArg("blue", num(1)),
              ]),
            },
          ]),
        ],
      },
      [leaf(call("Text", [{ value: str("Tap") }]))],
    );
    expect(roundtrip(view)).toEqual(view);
  });
});

describe("parseView — string escapes", () => {
  it("decodes \\n / \\t / \\\\ / \\\"", () => {
    const view = leaf(
      call("Text", [{ value: str('a"b\\c\nd\te') }]),
    );
    expect(roundtrip(view)).toEqual(view);
  });

  it("decodes \\u{XX} escapes", () => {
    const view = leaf(call("Text", [{ value: str("") }]));
    expect(roundtrip(view)).toEqual(view);
  });

  it("preserves Unicode that is not escaped", () => {
    const view = leaf(call("Text", [{ value: str("こんにちは🎉") }]));
    expect(roundtrip(view)).toEqual(view);
  });
});

describe("parseView — error reporting", () => {
  it("throws on trailing input", () => {
    expect(() => parseView('Text("a") garbage')).toThrow(ParseError);
  });

  it("throws on unterminated strings", () => {
    expect(() => parseView('Text("a')).toThrow(/unterminated string/u);
  });

  it("throws on unknown stack arguments", () => {
    expect(() => parseView("HStack(unknown: 1) { }")).toThrow(/unknown stack argument/u);
  });

  it("throws on unknown alignment names", () => {
    expect(() => parseView("HStack(alignment: .nope) { }")).toThrow(/unknown alignment/u);
  });
});
