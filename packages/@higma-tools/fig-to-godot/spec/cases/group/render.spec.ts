/**
 * @file Round-trip spec for the `group` fixture. Per-frame diffCapPct is
 * calibrated against the WebGL reference at pixelmatch threshold 0.0
 * (any byte difference counts). Frames not listed exercise a fig
 * feature the v0 emit does not yet model and are deferred.
 */
import { runRoundtripCase } from "../run-case";

await runRoundtripCase({
  caseName: "group",
  canvasName: "Page 1",
  frameNames: [
    "group-basic",
    "group-sized",
    "group-rotated",
    "group-opacity",
    "group-nested",
    "group-hidden",
  ],
  diffCapPct: {
    "group-basic": 0.09,
    "group-sized": 0.09,
    "group-rotated": 13.1,
    "group-opacity": 15.746,
    "group-nested": 11.714,
    "group-hidden": 0.09,
  },
});
