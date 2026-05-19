/**
 * @file Lock down the external-css (BEM) registry, rewriter, and
 * path routines.
 *
 * `external-css` differs from `css-modules` in three places the spec
 * pins: block-scoped class names (so a single global stylesheet can
 * carry rules from multiple components without collision), literal
 * `className="…"` props on the JSX side (no `classes.cN` indirection),
 * and a run-wide registry rather than a per-file collector.
 */
import {
  blockSlugFromName,
  createExternalCssRegistry,
  externalStylesheetImport,
  relativeStylesheetSpecifier,
  rewriteForExternalCss,
} from "./external-css";
import { el, strProp, styleProp } from "../../../lib/jsx-tree/builder";

describe("blockSlugFromName", () => {
  it("kebab-cases the name", () => {
    expect(blockSlugFromName("Home Page")).toBe("home-page");
    expect(blockSlugFromName("Sign In Form")).toBe("sign-in-form");
  });

  it("collapses runs of non-alphanumerics into a single hyphen", () => {
    expect(blockSlugFromName("Card __ A / B")).toBe("card-a-b");
  });

  it("throws when the input yields no usable slug (fail-fast contract)", () => {
    expect(() => blockSlugFromName("")).toThrow(/cannot derive a block slug/);
    expect(() => blockSlugFromName("   ")).toThrow(/cannot derive a block slug/);
    expect(() => blockSlugFromName("///")).toThrow(/cannot derive a block slug/);
  });
});

describe("createExternalCssRegistry", () => {
  it("scopes class names by block: `<block>__c<n>`", () => {
    const registry = createExternalCssRegistry();
    const home = registry.forBlock("home");
    const card = registry.forBlock("card");
    expect(home.register([{ key: "color", value: "red" }])).toBe("home__c1");
    expect(card.register([{ key: "color", value: "red" }])).toBe("card__c1");
    // Independent counters per block — same style value, distinct
    // classes so each block reads as a self-contained set in the
    // shared stylesheet.
    expect(home.register([{ key: "color", value: "blue" }])).toBe("home__c2");
  });

  it("dedups identical records inside the same block", () => {
    const registry = createExternalCssRegistry();
    const home = registry.forBlock("home");
    const a = home.register([{ key: "color", value: "red" }]);
    const b = home.register([{ key: "color", value: "red" }]);
    expect(a).toBe(b);
  });

  it("renders one stylesheet covering every block's rules", () => {
    const registry = createExternalCssRegistry();
    registry.forBlock("home").register([{ key: "padding", value: "12px" }]);
    registry.forBlock("card").register([{ key: "fontSize", value: "16px" }]);
    const file = registry.renderStylesheet("styles.css");
    if (!file) {
      throw new Error("expected a stylesheet file");
    }
    expect(file.path).toBe("styles.css");
    expect(file.contents).toContain(".home__c1 {");
    expect(file.contents).toContain("padding: 12px;");
    expect(file.contents).toContain(".card__c1 {");
    expect(file.contents).toContain("font-size: 16px;");
  });

  it("returns undefined when no rule was registered", () => {
    const registry = createExternalCssRegistry();
    expect(registry.renderStylesheet("styles.css")).toBeUndefined();
  });
});

describe("rewriteForExternalCss", () => {
  it("replaces style with a literal className string prop", () => {
    const registry = createExternalCssRegistry();
    const collector = registry.forBlock("home");
    const tree = el("div", { props: [styleProp({ color: "red" })] });
    const out = rewriteForExternalCss(tree, collector);
    if (out.kind !== "element") {
      throw new Error("expected element");
    }
    expect(out.props).toEqual([strProp("className", "home__c1")]);
  });

  it("recurses into children", () => {
    const registry = createExternalCssRegistry();
    const collector = registry.forBlock("home");
    const tree = el("div", {
      props: [styleProp({ color: "red" })],
      children: [el("span", { props: [styleProp({ color: "blue" })] })],
    });
    const out = rewriteForExternalCss(tree, collector);
    if (out.kind !== "element") {
      throw new Error("expected element");
    }
    expect(collector.rules().map((r) => r.className)).toEqual(["home__c1", "home__c2"]);
  });
});

describe("stylesheet import / specifier routines", () => {
  it("computes a same-directory specifier from output root", () => {
    expect(relativeStylesheetSpecifier("Home.tsx", "styles.css")).toBe("./styles.css");
  });

  it("computes a `../`-prefixed specifier for nested TSX", () => {
    expect(relativeStylesheetSpecifier("pages/design/Home.tsx", "styles.css")).toBe(
      "../../styles.css",
    );
  });

  it("emits an `import \"...\";` line in direct mode and nothing in external mode", () => {
    expect(externalStylesheetImport("pages/design/Home.tsx", "styles.css", "direct")).toBe(
      `import "../../styles.css";`,
    );
    expect(externalStylesheetImport("pages/design/Home.tsx", "styles.css", "external")).toBe("");
  });
});
