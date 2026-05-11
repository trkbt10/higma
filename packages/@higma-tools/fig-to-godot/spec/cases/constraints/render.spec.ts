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
  // Constraint emission is structural — child positioning under
  // parent resize. The previous wide caps (12-38%) papered over real
  // bugs in SCALE / STRETCH constraint resolution. Reset to 0.5% so
  // the gaps surface and get fixed in the constraint code path.
  diffCapPct: {
    "MIN-MIN": 0.5,
    "MIN-CENTER": 0.5,
    "MIN-MAX": 0.5,
    "MIN-STRETCH": 0.5,
    "MIN-SCALE": 0.5,
    "CENTER-MIN": 0.5,
    "CENTER-CENTER": 0.5,
    "CENTER-MAX": 0.5,
    "CENTER-STRETCH": 0.5,
    "CENTER-SCALE": 0.5,
    "MAX-MIN": 0.5,
    "MAX-CENTER": 0.5,
    "MAX-MAX": 0.5,
    "MAX-STRETCH": 0.5,
    "MAX-SCALE": 0.5,
    "STRETCH-MIN": 0.5,
    "STRETCH-CENTER": 0.5,
    "STRETCH-MAX": 0.5,
    "STRETCH-SCALE": 0.5,
    "SCALE-MIN": 0.5,
    "SCALE-CENTER": 0.5,
    "SCALE-MAX": 0.5,
    "SCALE-SCALE": 0.5,
  },
});
