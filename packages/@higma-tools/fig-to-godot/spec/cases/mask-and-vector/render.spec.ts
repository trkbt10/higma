/**
 * @file Round-trip spec for the `mask-and-vector` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "mask-and-vector",
  canvasName: "Mask & Vector",
  frameNames: [
    "mask-circle",
    "vector-paths",
  ],
  diffCapPct: {
    "mask-circle": 0.09,
    "vector-paths": 0.09,
  },
});
