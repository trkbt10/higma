/**
 * @file Lock down the CSS-Modules collector and JSX rewriter.
 *
 * The collector is the single source of truth for class naming and
 * style dedup. The rewriter is the single point where a JsxNode tree
 * loses its inline `style={{ … }}` props in favour of
 * `className={classes.cN}`. Testing both directly keeps the unit
 * small and the failure messages legible when the contract drifts.
 */
import {
  buildCssModuleFile,
  createCssModulesCollector,
  cssModuleImportLine,
  cssModulePathFor,
  cssPropertyName,
  rewriteForCssModules,
} from "./css-modules";
import { el, exprProp, strProp, styleProp } from "../../../lib/jsx-tree/builder";

describe("cssPropertyName", () => {
  it("converts camelCase to kebab-case", () => {
    expect(cssPropertyName("backgroundImage")).toBe("background-image");
    expect(cssPropertyName("flexDirection")).toBe("flex-direction");
  });

  it("prefixes vendor keys with a hyphen (Webkit → -webkit-)", () => {
    expect(cssPropertyName("WebkitBackdropFilter")).toBe("-webkit-backdrop-filter");
  });

  it("passes CSS custom properties through verbatim", () => {
    expect(cssPropertyName("--color-primary")).toBe("--color-primary");
  });
});

describe("createCssModulesCollector", () => {
  it("assigns sequential class names c1, c2, …", () => {
    const collector = createCssModulesCollector();
    const a = collector.register([{ key: "color", value: "red" }]);
    const b = collector.register([{ key: "color", value: "blue" }]);
    expect(a).toBe("c1");
    expect(b).toBe("c2");
  });

  it("dedups identical style records onto the same class", () => {
    const collector = createCssModulesCollector();
    const a = collector.register([
      { key: "color", value: "red" },
      { key: "fontSize", value: "16px" },
    ]);
    const b = collector.register([
      { key: "fontSize", value: "16px" },
      { key: "color", value: "red" },
    ]);
    expect(a).toBe("c1");
    // Order-insensitive: same canonical key → same class.
    expect(b).toBe("c1");
  });

  it("renders kebab-case CSS rules for each class", () => {
    const collector = createCssModulesCollector();
    collector.register([
      { key: "flexDirection", value: "column" },
      { key: "--token-color", value: "rgb(0, 0, 0)" },
    ]);
    const css = collector.renderModule();
    expect(css).toContain(".c1 {");
    expect(css).toContain("flex-direction: column;");
    expect(css).toContain("--token-color: rgb(0, 0, 0);");
    expect(css.trim().endsWith("}")).toBe(true);
  });
});

describe("rewriteForCssModules", () => {
  it("replaces a style prop with a className expression", () => {
    const collector = createCssModulesCollector();
    const tree = el("div", {
      props: [styleProp({ color: "red", fontSize: "16px" })],
    });
    const out = rewriteForCssModules(tree, collector);
    if (out.kind !== "element") {
      throw new Error("expected element root");
    }
    expect(out.props.length).toBe(1);
    const prop = out.props[0];
    expect(prop?.kind).toBe("expr");
    expect(prop).toEqual(exprProp("className", "classes.c1"));
  });

  it("recurses into children and registers their styles", () => {
    const collector = createCssModulesCollector();
    const tree = el("div", {
      props: [styleProp({ display: "flex" })],
      children: [
        el("span", {
          props: [styleProp({ color: "red" })],
        }),
      ],
    });
    const out = rewriteForCssModules(tree, collector);
    if (out.kind !== "element") {
      throw new Error("expected element root");
    }
    const rules = collector.rules();
    expect(rules.length).toBe(2);
    expect(rules.map((r) => r.className)).toEqual(["c1", "c2"]);
  });

  it("preserves non-style props unchanged", () => {
    const collector = createCssModulesCollector();
    const tree = el("div", {
      props: [
        strProp("data-fig-name", "Home"),
        styleProp({ color: "red" }),
        exprProp("aria-pressed", "true"),
      ],
    });
    const out = rewriteForCssModules(tree, collector);
    if (out.kind !== "element") {
      throw new Error("expected element root");
    }
    expect(out.props.length).toBe(3);
    expect(out.props[0]).toEqual(strProp("data-fig-name", "Home"));
    expect(out.props[1]).toEqual(exprProp("className", "classes.c1"));
    expect(out.props[2]).toEqual(exprProp("aria-pressed", "true"));
  });

  it("drops empty style props rather than registering an empty class", () => {
    const collector = createCssModulesCollector();
    const tree = el("div", { props: [styleProp({})] });
    const out = rewriteForCssModules(tree, collector);
    if (out.kind !== "element") {
      throw new Error("expected element root");
    }
    expect(out.props.length).toBe(0);
    expect(collector.rules().length).toBe(0);
  });
});

describe("buildCssModuleFile / path routines", () => {
  it("derives the .module.css path from a .tsx path", () => {
    expect(cssModulePathFor("pages/home/index.tsx")).toBe("pages/home/index.module.css");
  });

  it("renders the import line with a same-directory specifier", () => {
    expect(cssModuleImportLine("pages/home/Home.tsx")).toBe(
      `import classes from "./Home.module.css";`,
    );
    expect(cssModuleImportLine("Top.tsx")).toBe(`import classes from "./Top.module.css";`);
  });

  it("returns undefined when the collector recorded no rules", () => {
    const collector = createCssModulesCollector();
    expect(buildCssModuleFile("Foo.tsx", collector)).toBeUndefined();
  });

  it("emits an EmitFile when rules exist", () => {
    const collector = createCssModulesCollector();
    collector.register([{ key: "color", value: "red" }]);
    const file = buildCssModuleFile("pages/Home.tsx", collector);
    if (!file) {
      throw new Error("expected sidecar EmitFile");
    }
    expect(file.path).toBe("pages/Home.module.css");
    expect(file.contents).toContain(".c1");
    expect(file.contents).toContain("color: red;");
  });
});
