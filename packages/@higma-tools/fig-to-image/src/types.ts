/**
 * @file Local structural types describing the WebGL harness API
 * we consume.
 *
 * `@higma-tools/web-fig-roundtrip` is a same-scope sibling so we
 * cannot statically import (or re-export) its types — the
 * `enforce-package-boundaries` lint rule forbids it. Instead we
 * declare the *shape* of the values we touch locally; the runtime
 * `dynamic import` in `harness/loader.ts` returns objects that
 * structurally satisfy these interfaces. Keeping the types here
 * keeps the consumer modules typed without crossing the package
 * boundary.
 *
 * If web-fig-roundtrip changes its API surface, this file is the
 * single place to update — the loader and CLI just see typed
 * values flow through.
 */
import type { FigNode } from "@higma-document-models/fig/types";

/** A single rasterisation target — output of `listFigFrameTargets`. */
export type FigFrameTarget = {
  readonly page: string;
  readonly frame: string;
  readonly type: string;
  readonly node: FigNode;
  readonly width: number;
  readonly height: number;
};

/** A rasterised frame yielded by `streamFigFrames`. */
export type FigFrameRendered = {
  readonly target: FigFrameTarget;
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
};

/** Handle to a running WebGL harness — `harness.stop()` tears it down. */
export type WebglHarness = {
  stop(): Promise<void>;
};

/** Options consumed by `listFigFrameTargets`. */
export type ListFigFrameTargetsOptions = {
  readonly frameNames?: readonly string[];
  readonly pageName?: string;
  readonly includeSymbols?: boolean;
};

/** RGBA in 0..1 — same shape the renderer's `backgroundColor` accepts. */
export type Rgba = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};

/** Options consumed by `streamFigFrames`. */
export type StreamFigFramesOptions = {
  readonly pixelRatio?: number;
  readonly backgroundColor?: Rgba;
};

/**
 * Subset of `@higma-tools/web-fig-roundtrip/verify` we consume.
 * The dynamic loader in `harness/loader.ts` returns a value typed
 * against this interface, so the rest of the package never
 * references the sibling-package types directly.
 */
export type HarnessApi = {
  readonly startWebglHarness: () => Promise<WebglHarness>;
  readonly listFigFrameTargets: (
    figBytes: Uint8Array,
    options?: ListFigFrameTargetsOptions,
  ) => Promise<readonly FigFrameTarget[]>;
  readonly streamFigFrames: (
    harness: WebglHarness,
    figBytes: Uint8Array,
    targets: readonly FigFrameTarget[],
    options?: StreamFigFramesOptions,
  ) => AsyncGenerator<FigFrameRendered, void, unknown>;
};
