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
  // Target swiftui-peer level (0.5%). Image fills require byte-precise
  // bilinear sampling matching WebGL's texture filter; failures indicate
  // sampling-precision gaps that should be fixed in the rasterizer.
  diffCapPct: {
    "image-fill-basic": 0.5,
    "image-fill-shadow": 0.5,
    "image-fill-circle": 0.5,
    "image-fill-multi": 0.5,
  },
});
