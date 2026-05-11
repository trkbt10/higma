/**
 * @file Round-trip spec for the `boolean` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "boolean",
  canvasName: "Page 1",
  frameNames: [
    "bool-union",
    "bool-subtract",
    "bool-intersect",
    "bool-exclude",
    "bool-opacity",
    "bool-3-operands",
    "bool-donut",
    "bool-operation-method",
  ],
  diffCapPct: {
    "bool-union": 0.09,
    "bool-subtract": 0.09,
    "bool-intersect": 0.09,
    "bool-exclude": 0.09,
    "bool-opacity": 18.2,
    "bool-3-operands": 0.09,
    "bool-donut": 0.78,
    "bool-operation-method": 0.09,
  },
});
