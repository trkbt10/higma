/**
 * @file Round-trip spec for the `constraints` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "constraints",
  canvasName: "Single Constraints",
  frameNames: [
    "MIN-MIN",
    "MIN-CENTER",
    "MIN-MAX",
    "MIN-STRETCH",
    "MIN-SCALE",
    "CENTER-MIN",
    "CENTER-CENTER",
    "CENTER-MAX",
    "CENTER-STRETCH",
    "CENTER-SCALE",
    "MAX-MIN",
    "MAX-CENTER",
    "MAX-MAX",
    "MAX-STRETCH",
    "MAX-SCALE",
    "STRETCH-MIN",
    "STRETCH-CENTER",
    "STRETCH-MAX",
    "STRETCH-SCALE",
    "SCALE-MIN",
    "SCALE-CENTER",
    "SCALE-MAX",
    "SCALE-SCALE",
  ],
  diffCapPct: {
    "MIN-MIN": 12.036,
    "MIN-CENTER": 12.036,
    "MIN-MAX": 12.036,
    "MIN-STRETCH": 27.59,
    "MIN-SCALE": 19.456,
    "CENTER-MIN": 12.036,
    "CENTER-CENTER": 12.036,
    "CENTER-MAX": 12.036,
    "CENTER-STRETCH": 27.59,
    "CENTER-SCALE": 19.456,
    "MAX-MIN": 12.036,
    "MAX-CENTER": 12.036,
    "MAX-MAX": 12.036,
    "MAX-STRETCH": 27.59,
    "MAX-SCALE": 19.456,
    "STRETCH-MIN": 23.698,
    "STRETCH-CENTER": 23.698,
    "STRETCH-MAX": 23.698,
    "STRETCH-SCALE": 38.51,
    "SCALE-MIN": 19.036,
    "SCALE-CENTER": 19.036,
    "SCALE-MAX": 19.036,
    "SCALE-SCALE": 30.894,
  },
});
