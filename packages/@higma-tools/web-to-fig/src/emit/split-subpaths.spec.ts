/**
 * @file Unit tests for `splitSubpaths`.
 *
 * The splitter feeds Figma's per-vectorPath subpath model — each
 * subpath needs to land in its own `vectorPath` entry so the
 * renderer's pen resets between them. The tests below pin the
 * splitter's behaviour at the cases that matter for that contract.
 */
import { splitSubpaths, splitSubpathsRespectingFillRule } from "./split-subpaths";

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

describe("splitSubpathsRespectingFillRule", () => {
  // Donut shape: outer rectangle, inner rectangle, in one path.
  // SVG's even-odd fill-rule cancels the overlap so a hole appears.
  const donut = "M 0 0 L 100 0 L 100 100 L 0 100 Z M 25 25 L 75 25 L 75 75 L 25 75 Z";

  it("keeps an even-odd multi-subpath donut path intact", () => {
    // Splitting would turn the donut hole into a second filled disk
    // because Figma evaluates winding per-vectorPath entry — the
    // even-odd cross-subpath cancellation only works inside ONE
    // entry. So the splitter must return the whole `d` as a single
    // entry when fillRule === "evenodd".
    expect(splitSubpathsRespectingFillRule(donut, "evenodd")).toEqual([donut]);
  });

  it("splits a nonzero multi-subpath path into its M-rooted segments", () => {
    // Nonzero fill-rule fills each subpath independently anyway, so
    // splitting only protects against the cross-subpath pen-position
    // join — same behaviour as `splitSubpaths` directly.
    expect(splitSubpathsRespectingFillRule(donut, "nonzero")).toEqual([
      "M 0 0 L 100 0 L 100 100 L 0 100 Z",
      "M 25 25 L 75 25 L 75 75 L 25 75 Z",
    ]);
  });

  it("treats undefined fill-rule as nonzero (the SVG default)", () => {
    expect(splitSubpathsRespectingFillRule(donut, undefined)).toEqual([
      "M 0 0 L 100 0 L 100 100 L 0 100 Z",
      "M 25 25 L 75 25 L 75 75 L 25 75 Z",
    ]);
  });

  it("returns the empty string unchanged regardless of fill-rule", () => {
    expect(splitSubpathsRespectingFillRule("", "evenodd")).toEqual([""]);
    expect(splitSubpathsRespectingFillRule("", "nonzero")).toEqual([""]);
  });

  it("does nothing different from the plain splitter for single-subpath input", () => {
    const single = "M 0 0 L 10 10 L 20 0 Z";
    expect(splitSubpathsRespectingFillRule(single, "evenodd")).toEqual([single]);
    expect(splitSubpathsRespectingFillRule(single, "nonzero")).toEqual([single]);
  });
});
