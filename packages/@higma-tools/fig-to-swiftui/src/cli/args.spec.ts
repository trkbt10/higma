/**
 * @file Spec for fig-to-swiftui CLI argument parsing.
 */
import { CliUsageError, parseArgs } from "./args";

describe("parseArgs", () => {
  it("parses required arguments", () => {
    const opts = parseArgs(["--input", "doc.fig", "--out", "out"]);
    expect(opts).toEqual({
      input: "doc.fig",
      out: "out",
      page: "Design",
      mode: "all",
      frame: undefined,
    });
  });

  it("uses --page override", () => {
    const opts = parseArgs(["--input", "doc.fig", "--out", "out", "--page", "Mobile"]);
    expect(opts.page).toBe("Mobile");
  });

  it("returns mode=single when --frame is supplied", () => {
    const opts = parseArgs(["--input", "doc.fig", "--out", "out", "--frame", "Home"]);
    expect(opts.mode).toBe("single");
    expect(opts.frame).toBe("Home");
  });

  it("returns mode=list and tolerates missing --out", () => {
    const opts = parseArgs(["--input", "doc.fig", "--list"]);
    expect(opts.mode).toBe("list");
    expect(opts.out).toBe("");
  });

  it("throws on unknown arguments", () => {
    expect(() => parseArgs(["--input", "doc.fig", "--out", "out", "--mystery"]))
      .toThrow(CliUsageError);
  });

  it("throws when --input is missing", () => {
    expect(() => parseArgs(["--out", "out"])).toThrow(/--input/u);
  });

  it("throws when --out is missing (and not in list mode)", () => {
    expect(() => parseArgs(["--input", "doc.fig"])).toThrow(/--out/u);
  });
});
