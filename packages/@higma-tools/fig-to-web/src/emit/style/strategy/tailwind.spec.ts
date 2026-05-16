/**
 * @file Lock down the Tailwind translator.
 *
 * Three tiers must hold:
 *   1. Categorical CSS values map to their Tailwind utility name.
 *   2. Single-value numeric / color properties land in the
 *      arbitrary-bracket form `prefix-[value]` so the JIT can scan
 *      them statically.
 *   3. Unrecognised properties fall back to `[property:value]` so the
 *      generated `className` stays loss-less even when a translator
 *      table entry is missing.
 *
 * Multi-value shorthands (`padding: 12px 16px`) must split into
 * per-side utilities — Tailwind has no two-value shorthand utility.
 */
import { rewriteForTailwind, styleEntriesToTailwind } from "./tailwind";
import { el, strProp, styleProp } from "../../../lib/jsx-tree/builder";

describe("styleEntriesToTailwind", () => {
  it("translates categorical properties to utility names", () => {
    const out = styleEntriesToTailwind([
      { key: "display", value: "flex" },
      { key: "flexDirection", value: "column" },
      { key: "alignItems", value: "center" },
      { key: "justifyContent", value: "space-between" },
    ]);
    expect(out).toEqual(["flex", "flex-col", "items-center", "justify-between"]);
  });

  it("uses the arbitrary form for numeric / color properties", () => {
    const out = styleEntriesToTailwind([
      { key: "gap", value: "12px" },
      { key: "top", value: "0" },
      { key: "color", value: "rgb(0, 0, 0)" },
      { key: "background", value: "var(--color-primary)" },
    ]);
    expect(out).toEqual([
      "gap-[12px]",
      "top-[0]",
      "text-[rgb(0,_0,_0)]",
      "bg-[var(--color-primary)]",
    ]);
  });

  it("falls back to [property:value] for unrecognised CSS", () => {
    const out = styleEntriesToTailwind([
      { key: "mixBlendMode", value: "multiply" },
      { key: "WebkitBackdropFilter", value: "blur(8px)" },
    ]);
    expect(out).toContain("[mix-blend-mode:multiply]");
    expect(out).toContain("[-webkit-backdrop-filter:blur(8px)]");
  });

  it("splits padding shorthands into per-side utilities", () => {
    expect(styleEntriesToTailwind([{ key: "padding", value: "12px" }])).toEqual([
      "p-[12px]",
    ]);
    expect(styleEntriesToTailwind([{ key: "padding", value: "12px 16px" }])).toEqual([
      "pt-[12px]",
      "pr-[16px]",
      "pb-[12px]",
      "pl-[16px]",
    ]);
    expect(styleEntriesToTailwind([{ key: "padding", value: "1px 2px 3px 4px" }])).toEqual([
      "pt-[1px]",
      "pr-[2px]",
      "pb-[3px]",
      "pl-[4px]",
    ]);
  });

  it("splits border-radius shorthands per-corner in CSS order (tl, tr, br, bl)", () => {
    expect(
      styleEntriesToTailwind([{ key: "borderRadius", value: "12px 0 0 12px" }]),
    ).toEqual([
      "rounded-tl-[12px]",
      "rounded-tr-[0]",
      "rounded-br-[0]",
      "rounded-bl-[12px]",
    ]);
  });

  it("dedups identical utilities within one style record", () => {
    const out = styleEntriesToTailwind([
      { key: "padding", value: "0 0 0 0" },
    ]);
    expect(out).toEqual(["pt-[0]", "pr-[0]", "pb-[0]", "pl-[0]"]);
  });

  it("preserves rgb()/rgba() commas by escaping whitespace only", () => {
    const out = styleEntriesToTailwind([
      { key: "color", value: "rgba(255, 255, 255, 0.5)" },
    ]);
    expect(out).toEqual(["text-[rgba(255,_255,_255,_0.5)]"]);
  });
});

describe("rewriteForTailwind", () => {
  it("replaces a style prop with a literal className", () => {
    const tree = el("div", { props: [styleProp({ display: "flex", gap: "8px" })] });
    const out = rewriteForTailwind(tree);
    if (out.kind !== "element") {
      throw new Error("expected element");
    }
    expect(out.props).toEqual([strProp("className", "flex gap-[8px]")]);
  });

  it("recurses into children, preserving non-style props", () => {
    const tree = el("div", {
      props: [
        strProp("data-fig-name", "Home"),
        styleProp({ display: "flex" }),
      ],
      children: [
        el("span", { props: [styleProp({ color: "red" })] }),
      ],
    });
    const out = rewriteForTailwind(tree);
    if (out.kind !== "element") {
      throw new Error("expected element");
    }
    expect(out.props).toEqual([
      strProp("data-fig-name", "Home"),
      strProp("className", "flex"),
    ]);
    const child = out.children[0];
    if (!child || child.kind !== "element") {
      throw new Error("expected element child");
    }
    expect(child.props).toEqual([strProp("className", "text-[red]")]);
  });

  it("drops empty style props rather than emitting an empty className", () => {
    const tree = el("div", { props: [styleProp({})] });
    const out = rewriteForTailwind(tree);
    if (out.kind !== "element") {
      throw new Error("expected element");
    }
    expect(out.props.length).toBe(0);
  });
});
