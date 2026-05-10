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
    "bool-union": 25.56,
    "bool-subtract": 12.484,
    "bool-intersect": 10.622,
    "bool-exclude": 15.144,
    "bool-opacity": 25.56,
    "bool-3-operands": 27.744,
    "bool-donut": 18.35,
    "bool-operation-method": 31.3,
  },
});
