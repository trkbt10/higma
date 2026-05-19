/**
 * @file Case `site-nav-with-logo` — universal site header pattern.
 * Asserts the four-level structure and the row autoLayout on the
 * `<nav>` and the `<ul>`.
 */
import { asFrame, normalizeOne, singleChild } from "../case-ir-assertions";
import {
  BRAND_TEXT,
  MENU_GAP,
  MENU_LABELS,
  siteNavWithLogo,
} from "./fixture";

describe("case site-nav-with-logo", () => {
  const ir = normalizeOne(siteNavWithLogo());
  const header = asFrame(singleChild(ir));

  it("preserves the `<header>` → `<nav>` nesting", () => {
    expect(header.children).toHaveLength(1);
    const nav = header.children[0];
    if (!nav || nav.kind !== "frame") {
      throw new Error("expected <nav> frame");
    }
    expect(nav.children).toHaveLength(2);
  });

  it("recovers row autoLayout on the `<nav>` from explicit flex", () => {
    const nav = header.children[0];
    if (!nav || nav.kind !== "frame") {
      throw new Error("expected <nav> frame");
    }
    if (nav.autoLayout.direction === "none") {
      throw new Error("expected nav row autoLayout");
    }
    expect(nav.autoLayout.direction).toBe("row");
  });

  it("collapses the brand `<a>` to a TEXT carrying the brand label", () => {
    const nav = header.children[0];
    if (!nav || nav.kind !== "frame") {
      throw new Error("expected <nav> frame");
    }
    const brand = nav.children[0];
    if (!brand || brand.kind !== "text") {
      throw new Error("expected brand text");
    }
    expect(brand.characters).toBe(BRAND_TEXT);
  });

  it("preserves all menu items in the `<ul>` row", () => {
    const nav = header.children[0];
    if (!nav || nav.kind !== "frame") {
      throw new Error("expected <nav> frame");
    }
    const ul = nav.children[1];
    if (!ul || ul.kind !== "frame") {
      throw new Error("expected <ul> frame");
    }
    expect(ul.children).toHaveLength(MENU_LABELS.length);
    if (ul.autoLayout.direction === "none") {
      throw new Error("expected ul row autoLayout");
    }
    expect(ul.autoLayout.direction).toBe("row");
    expect(ul.autoLayout.gap).toBe(MENU_GAP);
  });
});
