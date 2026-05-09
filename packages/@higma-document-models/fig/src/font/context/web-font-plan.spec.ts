/**
 * @file Spec — `buildWebFontPlan`.
 */
import { buildWebFontPlan } from "./web-font-plan";
import type { FontQuery } from "../query";

const Q = (family: string, weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, style: "normal" | "italic" | "oblique"): FontQuery =>
  ({ family, weight, style });

describe("buildWebFontPlan", () => {
  it("returns empty plan and no href for no queries", () => {
    const plan = buildWebFontPlan([]);
    expect(plan.families).toEqual([]);
    expect(plan.googleFontsHref).toBeUndefined();
  });

  it("emits one family entry per distinct family", () => {
    const plan = buildWebFontPlan([
      Q("Inter", 400, "normal"),
      Q("Roboto", 700, "normal"),
    ]);
    expect(plan.families.map((f) => f.family).sort()).toEqual(["Inter", "Roboto"]);
  });

  it("collapses repeated weights / styles inside one family", () => {
    const plan = buildWebFontPlan([
      Q("Inter", 400, "normal"),
      Q("Inter", 400, "normal"),
      Q("Inter", 700, "normal"),
      Q("Inter", 400, "italic"),
    ]);
    expect(plan.families.length).toBe(1);
    const fam = plan.families[0];
    expect(fam.family).toBe("Inter");
    expect(fam.weights).toEqual([400, 700]);
    expect(fam.styles).toEqual(["normal", "italic"]);
  });

  it("filters generic CSS keywords (system-ui, sans-serif, …) out of the plan", () => {
    const plan = buildWebFontPlan([
      Q("system-ui", 400, "normal"),
      Q("sans-serif", 400, "normal"),
      Q("monospace", 400, "normal"),
      Q("Inter", 400, "normal"),
    ]);
    expect(plan.families.map((f) => f.family)).toEqual(["Inter"]);
  });

  it("respects skipFamilies opt-out (e.g. proprietary fonts)", () => {
    const plan = buildWebFontPlan(
      [Q("Inter", 400, "normal"), Q("AcmeBrand", 400, "normal")],
      { skipFamilies: new Set(["AcmeBrand"]) },
    );
    expect(plan.families.map((f) => f.family)).toEqual(["Inter"]);
  });

  it("encodes the Google Fonts CSS2 URL with ital,wght tuples", () => {
    const plan = buildWebFontPlan([
      Q("Inter", 400, "normal"),
      Q("Inter", 700, "normal"),
    ]);
    expect(plan.googleFontsHref).toContain("https://fonts.googleapis.com/css2?");
    expect(plan.googleFontsHref).toContain("family=Inter:ital,wght@");
    expect(plan.googleFontsHref).toContain("0,400");
    expect(plan.googleFontsHref).toContain("0,700");
    expect(plan.googleFontsHref).toContain("display=swap");
  });

  it("requests italic weights when italic style is referenced", () => {
    const plan = buildWebFontPlan([
      Q("Inter", 400, "normal"),
      Q("Inter", 700, "italic"),
    ]);
    expect(plan.googleFontsHref).toContain("0,400");
    expect(plan.googleFontsHref).toContain("0,700");
    expect(plan.googleFontsHref).toContain("1,400");
    expect(plan.googleFontsHref).toContain("1,700");
  });

  it("does not over-request 100..900 sweep when only 400 is needed", () => {
    const plan = buildWebFontPlan([Q("Inter", 400, "normal")]);
    const href = plan.googleFontsHref ?? "";
    expect(href).toContain("0,400");
    expect(href).not.toContain("0,100");
    expect(href).not.toContain("0,200");
    expect(href).not.toContain("0,900");
  });
});
