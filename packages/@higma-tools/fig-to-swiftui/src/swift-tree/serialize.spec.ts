/**
 * @file Spec for the SwiftUI tree serializer.
 *
 * Locks in the surface contract: stack composition, modifier chaining,
 * number formatting, and string escaping. Any change in output here is
 * a behaviour change observable to consumers.
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
import { printNumber, serialize, swiftStringLiteral } from "./serialize";

describe("printNumber", () => {
  it("prints integers without a decimal", () => {
    expect(printNumber(320)).toBe("320");
    expect(printNumber(0)).toBe("0");
    expect(printNumber(-12)).toBe("-12");
  });

  it("trims trailing zeroes on decimals", () => {
    expect(printNumber(0.5)).toBe("0.5");
    expect(printNumber(1.25)).toBe("1.25");
  });

  it("throws for non-finite numbers", () => {
    expect(() => printNumber(NaN)).toThrow(/non-finite/u);
    expect(() => printNumber(Infinity)).toThrow(/non-finite/u);
  });
});

describe("swiftStringLiteral", () => {
  it("escapes backslashes and double quotes", () => {
    expect(swiftStringLiteral('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it("escapes common control characters", () => {
    expect(swiftStringLiteral("a\nb\tc")).toBe('"a\\nb\\tc"');
  });

  it("escapes other control bytes via \\u{XX}", () => {
    expect(swiftStringLiteral("")).toBe('"\\u{1}"');
  });

  it("passes printable Unicode through unchanged", () => {
    expect(swiftStringLiteral("こんにちは🎉")).toBe('"こんにちは🎉"');
  });
});

describe("serialize", () => {
  it("prints a single leaf with no modifiers", () => {
    const view = leaf(call("Text", [{ value: str("Hello") }]));
    expect(serialize(view)).toBe('Text("Hello")');
  });

  it("prints a leaf with modifiers chained on new lines", () => {
    const view = leaf(call("Text", [{ value: str("Hello") }]), [
      modifier("font", [{ value: call(".system", [namedArg("size", num(16))]) }]),
      modifier("foregroundColor", [{ value: member("red") }]),
    ]);
    expect(serialize(view)).toBe(
      [
        'Text("Hello")',
        "  .font(.system(size: 16))",
        "  .foregroundColor(.red)",
      ].join("\n"),
    );
  });

  it("prints a stack with alignment, spacing, and child views", () => {
    const view = stack(
      { stack: "VStack", alignment: "leading", spacing: 8 },
      [
        leaf(call("Text", [{ value: str("Hi") }])),
        leaf(ident("Color.blue"), [
          modifier("frame", [
            namedArg("width", num(320)),
            namedArg("height", num(44)),
          ]),
        ]),
      ],
    );
    expect(serialize(view)).toBe(
      [
        "VStack(alignment: .leading, spacing: 8) {",
        '  Text("Hi")',
        "  Color.blue",
        "    .frame(width: 320, height: 44)",
        "}",
      ].join("\n"),
    );
  });

  it("omits spacing on ZStack", () => {
    const view = stack(
      { stack: "ZStack", alignment: "topLeading", spacing: 8 },
      [leaf(member("clear"))],
    );
    expect(serialize(view)).toBe(
      [
        "ZStack(alignment: .topLeading) {",
        "  .clear",
        "}",
      ].join("\n"),
    );
  });

  it("indents nested stacks one level deeper per layer", () => {
    const view = stack({ stack: "VStack" }, [
      stack({ stack: "HStack", spacing: 4 }, [
        leaf(call("Text", [{ value: str("a") }])),
        leaf(call("Text", [{ value: str("b") }])),
      ]),
    ]);
    expect(serialize(view)).toBe(
      [
        "VStack {",
        "  HStack(spacing: 4) {",
        '    Text("a")',
        '    Text("b")',
        "  }",
        "}",
      ].join("\n"),
    );
  });

  it("prints empty stacks compactly", () => {
    const view = stack({ stack: "ZStack" }, []);
    expect(serialize(view)).toBe("ZStack { }");
  });
});
