/**
 * @file Unit tests for `parseFigLintArgs`.
 */

import { FigLintUsageError, parseFigLintArgs } from "./args";

describe("parseFigLintArgs", () => {
  it("returns the input list when only paths are passed", () => {
    const options = parseFigLintArgs(["a.fig", "b.fig"]);
    expect(options.inputs).toEqual(["a.fig", "b.fig"]);
    expect(options.format).toBe("text");
    expect(options.exitOn).toBe("errors");
    expect(options.help).toBe(false);
  });

  it("accepts --format and --exit-on with both space- and equals-separated values", () => {
    const a = parseFigLintArgs(["--format", "json", "--exit-on", "warnings", "x.fig"]);
    expect(a.format).toBe("json");
    expect(a.exitOn).toBe("warnings");

    const b = parseFigLintArgs(["--format=json", "--exit-on=any", "x.fig"]);
    expect(b.format).toBe("json");
    expect(b.exitOn).toBe("any");
  });

  it("toggles help without requiring an input", () => {
    const options = parseFigLintArgs(["--help"]);
    expect(options.help).toBe(true);
  });

  it("rejects unknown flags and missing inputs", () => {
    expect(() => parseFigLintArgs(["--bogus"])).toThrow(FigLintUsageError);
    expect(() => parseFigLintArgs([])).toThrow(FigLintUsageError);
    expect(() => parseFigLintArgs(["--format", "xml", "x.fig"])).toThrow(FigLintUsageError);
    expect(() => parseFigLintArgs(["--exit-on", "yolo", "x.fig"])).toThrow(FigLintUsageError);
  });
});
