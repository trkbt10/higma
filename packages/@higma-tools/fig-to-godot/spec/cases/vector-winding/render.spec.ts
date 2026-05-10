/**
 * @file Round-trip spec for the `vector-winding` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "vector-winding",
  canvasName: "Vector Winding",
  frameNames: [
    "winding-evenodd-donut",
    "winding-evenodd-ring",
    "winding-donut-stroke",
    "winding-arc-semi",
    "winding-arc-donut",
    "winding-stroke-arc",
  ],
  diffCapPct: {
    "winding-evenodd-donut": 12.162,
    "winding-evenodd-ring": 23.642,
    "winding-donut-stroke": 12.26,
    "winding-arc-semi": 24.188,
    "winding-arc-donut": 25.098,
    "winding-stroke-arc": 11.574,
  },
});
