/**
 * @file Round-trip spec for the `clip-rounded` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "clip-rounded",
  canvasName: "ClipRounded",
  frameNames: [
    "clip-rounded-basic",
    "clip-rounded-pill",
    "clip-rounded-nested",
    "clip-rounded-circle",
    "clip-rounded-gradient",
  ],
  diffCapPct: {
    "clip-rounded-basic": 0.5,
    "clip-rounded-pill": 0.5,
    "clip-rounded-nested": 0.45,
    "clip-rounded-circle": 0.5,
    "clip-rounded-gradient": 0.1,
  },
});
