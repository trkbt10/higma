/**
 * @file Round-trip spec for the `paint-advanced` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "paint-advanced",
  canvasName: "Paint Advanced",
  frameNames: [
    "angular-gradient-basic",
    "angular-gradient-rect",
    "angular-gradient-effect",
    "diamond-gradient",
    "multi-fill-solid",
    "multi-fill-gradient",
    "mask-basic",
    "mask-rounded",
  ],
  diffCapPct: {
    "angular-gradient-basic": 0.15,
    "angular-gradient-rect": 0.09,
    "angular-gradient-effect": 0.5,
    "diamond-gradient": 0.5,
    "multi-fill-solid": 0.09,
    "multi-fill-gradient": 0.05,
    "mask-basic": 0.3,
    "mask-rounded": 0.05,
  },
});
