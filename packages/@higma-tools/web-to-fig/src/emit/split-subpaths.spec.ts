/**
 * @file Unit tests for `splitSubpaths`.
 *
 * The splitter feeds Figma's per-vectorPath subpath model — each
 * subpath needs to land in its own `vectorPath` entry so the
 * renderer's pen resets between them. The tests below pin the
 * splitter's behaviour at the cases that matter for that contract.
 */
import { splitSubpaths } from "./split-subpaths";

describe("splitSubpaths", () => {
  it("returns the input verbatim when there is exactly one `M`", () => {
    const d = "M 0 0 L 10 0 L 10 10 Z";
    expect(splitSubpaths(d)).toEqual([d]);
  });

  it("splits two closed subpaths separated by an absolute `M`", () => {
    const d = "M 0 0 L 10 0 L 10 10 Z M 20 0 L 30 0 L 30 10 Z";
    expect(splitSubpaths(d)).toEqual([
      "M 0 0 L 10 0 L 10 10 Z",
      "M 20 0 L 30 0 L 30 10 Z",
    ]);
  });

  it("splits two subpaths even when the second starts with a relative `m`", () => {
    // The relative form references the prior pen position; preserving
    // `m` verbatim is correct because Figma resets the pen at every
    // vectorPath entry, so `m 5 5` inside a fresh entry resolves
    // against (0, 0) — the same position SVG would have at the start
    // of an isolated subpath.
    const d = "M 0 0 L 10 0 Z m 5 5 L 15 5 Z";
    expect(splitSubpaths(d)).toEqual([
      "M 0 0 L 10 0 Z",
      "m 5 5 L 15 5 Z",
    ]);
  });

  it("keeps an open subpath separate from the following closed subpath (the regression contract)", () => {
    // The bug: when the first subpath has no `Z`, the renderer's pen
    // sits at the last point and gets connected to the next M's
    // coordinates. Splitting prevents the cross-subpath line.
    const d = "M 0 0 L 10 10 M 20 20 L 30 30";
    expect(splitSubpaths(d)).toEqual([
      "M 0 0 L 10 10",
      "M 20 20 L 30 30",
    ]);
  });

  it("returns the input unchanged when there are no `M` commands", () => {
    // Malformed-but-survivable: emit one entry so the downstream
    // pipeline still sees something and the failure surfaces if the
    // path is genuinely broken.
    const d = "L 10 10 L 20 20";
    expect(splitSubpaths(d)).toEqual([d]);
  });

  it("strips per-subpath whitespace without re-formatting the body", () => {
    const d = "  M 0 0 L 10 0 Z   M 20 0 L 30 0 Z   ";
    expect(splitSubpaths(d)).toEqual([
      "M 0 0 L 10 0 Z",
      "M 20 0 L 30 0 Z",
    ]);
  });

  it("returns the empty string unchanged for an empty input", () => {
    expect(splitSubpaths("")).toEqual([""]);
  });
});
