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
    "composite-union-basic": 29.956,
    "composite-subtract-basic": 35.962,
    "composite-intersect-basic": 11.98,
    "composite-exclude-basic": 29.984,
    "composite-icon-gear": 9.894,
    "composite-icon-shield": 26.4,
    "composite-multi-union": 37.446,
    "composite-nested": 38.51,
    "composite-non-overlapping": 25.7,
    "composite-multiple": 37.866,
    "composite-opacity": 29.956,
    "composite-icon-bell": 39.714,
  },
});
