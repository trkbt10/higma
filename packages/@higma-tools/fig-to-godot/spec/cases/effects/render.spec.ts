/**
 * @file Round-trip spec for the `effects` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "effects",
  canvasName: "Page 1",
  frameNames: [
    "shadow-drop-basic",
    "shadow-drop-offset",
    "shadow-drop-multi",
    "shadow-inner",
    "blur-layer",
    "opacity-50",
    "shadow-shapes",
  ],
  diffCapPct: {
    "shadow-drop-basic": 26.344,
    "shadow-drop-offset": 12.82,
    "shadow-drop-multi": 38.818,
    "shadow-inner": 6.38,
    "blur-layer": 25.378,
    "opacity-50": 0.09,
    "shadow-shapes": 29.2,
  },
});
