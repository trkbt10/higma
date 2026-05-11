/**
 * @file Round-trip spec for the `stroke-styles` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "stroke-styles",
  canvasName: "Stroke Styles",
  frameNames: [
    "dash-uniform",
    "dash-asymmetric",
    "dash-tight",
    "arrow-lines",
    "arrow-equilateral",
  ],
  diffCapPct: {
    "dash-uniform": 0.09,
    "dash-asymmetric": 0.09,
    "dash-tight": 0.09,
    "arrow-lines": 0.09,
    "arrow-equilateral": 0.09,
  },
});
