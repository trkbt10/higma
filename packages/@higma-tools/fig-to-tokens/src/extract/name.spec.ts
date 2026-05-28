/** @file Unit tests for token-name slug helpers. */
import { buildCssId, buildTokenPath, slugifyForCss } from "./name";

describe("slugifyForCss", () => {
  it("lowercases and folds non-id chars to dashes", () => {
    expect(slugifyForCss("Brand/Primary 50%")).toBe("brand-primary-50");
  });

  it("collapses runs of dashes and trims edges", () => {
    expect(slugifyForCss("---hello   world---")).toBe("hello-world");
  });

  it("returns empty string for input that becomes all separators", () => {
    expect(slugifyForCss("///")).toBe("");
  });
});

describe("buildTokenPath", () => {
  it("flattens slash-separated segments and trims whitespace", () => {
    expect(buildTokenPath("Colors", "Brand/Primary 50%")).toBe(
      "Colors/Brand/Primary 50%",
    );
  });

  it("drops empty segments", () => {
    expect(buildTokenPath("", "Foo", "/Bar")).toBe("Foo/Bar");
  });
});

describe("buildCssId", () => {
  it("slugs each prefix + path segment and joins with dash", () => {
    expect(buildCssId("Brand/Primary 50%", "Colors")).toBe("colors-brand-primary-50");
  });

  it("drops segments that slug to empty", () => {
    expect(buildCssId("Foo", "")).toBe("foo");
  });
});
