/**
 * @file Round-trip spec for the `image-fill` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "image-fill",
  canvasName: "Image Fill",
  frameNames: [
    "image-fill-basic",
    "image-fill-shadow",
    "image-fill-circle",
    "image-fill-multi",
  ],
  diffCapPct: {
    "image-fill-basic": 8,
    "image-fill-shadow": 12,
    "image-fill-circle": 7.5,
    "image-fill-multi": 50,
  },
});
