/**
 * @file Round-trip spec for the `decoration-combo` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "decoration-combo",
  canvasName: "Decoration Combos",
  frameNames: [
    "solid-stroke-radius-shadow",
    "bool-gradient-union",
    "bool-gradient-subtract-shadow",
    "bool-rounded-operands",
    "clip-shadow",
    "grad-opacity",
  ],
  diffCapPct: {
    "solid-stroke-radius-shadow": 23.32,
    "bool-gradient-union": 40.316,
    "bool-gradient-subtract-shadow": 40.078,
    "bool-rounded-operands": 36.284,
    "clip-shadow": 21.262,
    "grad-opacity": 39.294,
  },
});
