/**
 * @file Unit specs for slug / filename helpers.
 *
 * Why so much detail for a 12-line helper: the slug is the
 * public contract between fig source names and on-disk PNG
 * filenames. Downstream tools (SwiftUI Image asset lookups,
 * Android resource ids, web `<img src>` paths) match by the slug
 * shape, so a quiet regression here would cascade into "asset
 * not found" failures.
 */
import { applyFilename, slugifyName } from "./slug";

describe("slugifyName", () => {
  it("lowercases ASCII letters", () => {
    expect(slugifyName("WindowTitle")).toBe("windowtitle");
  });

  it("collapses non-alphanumeric runs to a single hyphen", () => {
    expect(slugifyName("Button/Text/Regular")).toBe("button-text-regular");
    expect(slugifyName("g3028-7")).toBe("g3028-7");
    expect(slugifyName("Card 01")).toBe("card-01");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugifyName("---hello---")).toBe("hello");
    expect(slugifyName("__Window__")).toBe("window");
  });

  it("falls back to `frame` when the input has no alphanumerics", () => {
    expect(slugifyName("///")).toBe("frame");
    expect(slugifyName("")).toBe("frame");
    expect(slugifyName("   ")).toBe("frame");
  });

  it("preserves digits", () => {
    expect(slugifyName("Card 1")).toBe("card-1");
    expect(slugifyName("g308986")).toBe("g308986");
  });

  it("flattens unicode-non-latin runs to a single hyphen", () => {
    // Multi-byte glyphs (CJK / emoji) collapse to a single hyphen
    // separator — the slug is intentionally ASCII-only for
    // maximum filesystem portability.
    expect(slugifyName("ボタン")).toBe("frame");
    expect(slugifyName("hello世界world")).toBe("hello-world");
  });
});

describe("applyFilename", () => {
  it("substitutes {name} with the slug", () => {
    expect(applyFilename("{name}.png", "Window Title")).toBe("window-title.png");
  });

  it("supports multiple {name} occurrences", () => {
    expect(applyFilename("cards/{name}/{name}@2x.png", "g3028"))
      .toBe("cards/g3028/g3028@2x.png");
  });

  it("passes through templates without {name}", () => {
    expect(applyFilename("everything.png", "anything")).toBe("everything.png");
  });

  it("keeps unknown placeholder syntax verbatim", () => {
    expect(applyFilename("{name}-{rev}.png", "card-01")).toBe("card-01-{rev}.png");
  });
});
