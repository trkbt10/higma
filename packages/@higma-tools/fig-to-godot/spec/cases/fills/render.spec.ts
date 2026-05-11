/**
 * @file Round-trip spec for the `fills` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "fills",
  canvasName: "Fills Canvas",
  frameNames: [
    "stroke-dash",
    "solid-colors",
    "gradient-multi-stop",
    "gradient-radial",
    "stroke-align",
    "gradient-radial-offset",
    "solid-opacity",
    "stroke-basic",
    "gradient-linear-h",
    "stroke-caps",
    "gradient-linear-v",
    "gradient-linear-45",
  ],
  diffCapPct: {
    "stroke-dash": 0.09,
    "solid-colors": 0.5,
    "gradient-multi-stop": 0.09,
    "gradient-radial": 0.09,
    "stroke-align": 0.09,
    "gradient-radial-offset": 0.09,
    "solid-opacity": 0.09,
    "stroke-basic": 0.5,
    "gradient-linear-h": 0.09,
    "stroke-caps": 0.09,
    "gradient-linear-v": 0.09,
    "gradient-linear-45": 0.09,
  },
});
