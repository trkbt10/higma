/**
 * @file Round-trip spec for the `clips` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "clips",
  canvasName: "Clips Canvas",
  frameNames: [
    "clip-1level",
    "clip-2level",
    "clip-3level",
    "clip-overflow",
    "clip-nested-shapes",
    "clip-mixed",
    "clip-shapes-overlap",
  ],
  diffCapPct: {
    "clip-1level": 0.09,
    "clip-2level": 0.09,
    "clip-3level": 0.09,
    "clip-overflow": 0.09,
    "clip-nested-shapes": 0.09,
    "clip-mixed": 0.5,
    "clip-shapes-overlap": 0.09,
  },
});
