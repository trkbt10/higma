/**
 * @file Round-trip spec for the `rectangle` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "rectangle",
  canvasName: "Page 1",
  frameNames: [
    "rect-fill",
    "rect-stroke-only",
    "rect-fill-stroke",
    "rect-rotated",
    "rect-dashed",
    "rect-stroke-align",
    "rect-effect",
    "rect-sizes",
  ],
  diffCapPct: {
    "rect-fill": 0.09,
    "rect-stroke-only": 0.09,
    "rect-fill-stroke": 0.09,
    "rect-rotated": 0.5,
    "rect-dashed": 0.5,
    "rect-stroke-align": 0.09,
    "rect-effect": 0.5,
    "rect-sizes": 0.09,
  },
});
