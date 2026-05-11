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
    "shadow-drop-color",
    "shadow-inner",
    "blur-layer",
    "opacity-50",
    "shadow-shapes",
    "effects-combined",
  ],
  diffCapPct: {
    "shadow-drop-basic": 2.5,
    "shadow-drop-offset": 3,
    "shadow-drop-multi": 3,
    "shadow-drop-color": 14,
    "shadow-inner": 5.5,
    "blur-layer": 17,
    "opacity-50": 0.09,
    "shadow-shapes": 2.2,
    "effects-combined": 10,
  },
});
