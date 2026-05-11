/**
 * @file Round-trip spec for the `composite` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "composite",
  canvasName: "Composite Canvas",
  frameNames: [
    "composite-union-basic",
    "composite-subtract-basic",
    "composite-intersect-basic",
    "composite-exclude-basic",
    "composite-icon-gear",
    "composite-icon-shield",
    "composite-multi-union",
    "composite-nested",
    "composite-non-overlapping",
    "composite-multiple",
    "composite-opacity",
    "composite-icon-bell",
  ],
  diffCapPct: {
    "composite-union-basic": 0.09,
    "composite-subtract-basic": 0.5,
    "composite-intersect-basic": 0.09,
    "composite-exclude-basic": 0.09,
    "composite-icon-gear": 0.5,
    "composite-icon-shield": 0.09,
    "composite-multi-union": 0.09,
    "composite-nested": 0.5,
    "composite-non-overlapping": 0.09,
    "composite-multiple": 0.5,
    "composite-opacity": 0.09,
    "composite-icon-bell": 0.09,
  },
});
