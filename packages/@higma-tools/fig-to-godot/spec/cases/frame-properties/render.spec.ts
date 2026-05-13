/**
 * @file Round-trip spec for the `frame-properties` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "frame-properties",
  canvasName: "Frame Properties",
  frameNames: [
    "frame-bg-fill",
    "frame-corner-clip",
    "frame-nested",
    "frame-child-effects",
    "frame-drop-shadow",
    "frame-inner-shadow",
    "frame-stroke",
    "frame-overlap",
    "frame-deep-clip",
    "frame-opacity",
  ],
  diffCapPct: {
    "frame-bg-fill": 0.09,
    "frame-corner-clip": 0.09,
    "frame-nested": 0.09,
    "frame-child-effects": 0.09,
    "frame-drop-shadow": 1.0,
    "frame-inner-shadow": 0.5,
    "frame-stroke": 0.09,
    "frame-overlap": 0.09,
    "frame-deep-clip": 0.09,
    "frame-opacity": 0.09,
  },
});
