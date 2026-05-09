/**
 * @file Render every renderable top-level FRAME / COMPONENT in a
 * `.fig` byte buffer to SVG + PNG. Used by the verify command to
 * compare two refinement runs frame-by-frame.
 */
import { renderFigToSvg } from "@higma-document-renderers/fig/svg";
import { createCachingFontLoader } from "@higma-document-models/fig/font";
import { createNodeFontLoader } from "@higma-document-renderers/fig/font-drivers/node";
import { Resvg } from "@resvg/resvg-js";
import type { FigNode } from "@higma-document-models/fig/types";
import { getNodeType, safeChildren } from "@higma-document-models/fig/domain";
import {
  createFigSymbolContext,
  figRawResources,
  type FigSymbolContext,
} from "@higma-document-io/fig/context";

export type RenderedFrame = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly svg: string;
  readonly png: Uint8Array;
};

export type RenderFramesOptions = {
  readonly devicePixelRatio?: number;
  /**
   * When true, frames that fail to render (e.g. due to a missing OS font)
   * are reported via `onSkipFrame` and excluded rather than aborting the run.
   * Default false — the renderer's fail-fast contract is preserved.
   */
  readonly tolerateRenderErrors?: boolean;
  /** Called once per frame skipped because of `tolerateRenderErrors`. */
  readonly onSkipFrame?: (name: string, error: unknown) => void;
};

/** Render every renderable top-level FRAME / COMPONENT in a `.fig` byte buffer. */
export async function renderFrames(
  bytes: Uint8Array,
  options: RenderFramesOptions = {},
): Promise<readonly RenderedFrame[]> {
  const ctx = await createFigSymbolContext(bytes);
  const fontLoader = createCachingFontLoader(createNodeFontLoader());
  const dpr = options.devicePixelRatio ?? 1;

  const tolerate = options.tolerateRenderErrors === true;
  const onSkip = options.onSkipFrame;
  const out: RenderedFrame[] = [];
  for (const root of ctx.roots) {
    if (getNodeType(root) !== "DOCUMENT") {
      continue;
    }
    for (const canvas of safeChildren(root)) {
      if (getNodeType(canvas) !== "CANVAS" || canvas.internalOnly === true || canvas.visible === false) {
        continue;
      }
      for (const frame of safeChildren(canvas)) {
        const t = getNodeType(frame);
        if (t !== "FRAME" && t !== "COMPONENT") {
          continue;
        }
        if (!frame.size) {
          throw new Error(`renderFrames: frame "${frame.name ?? "?"}" has no size`);
        }
        const name = `${canvas.name ?? "(unnamed)"} / ${frame.name ?? "(unnamed)"}`;
        const rendered = await tryRenderFrame({ frame, ctx, fontLoader, dpr, tolerate });
        if (rendered.kind === "skipped") {
          onSkip?.(name, rendered.error);
          continue;
        }
        out.push({ name, ...rendered.frame });
      }
    }
  }
  return out;
}

type FrameRenderAttempt =
  | { readonly kind: "rendered"; readonly frame: { readonly width: number; readonly height: number; readonly svg: string; readonly png: Uint8Array } }
  | { readonly kind: "skipped"; readonly error: unknown };

type RenderArgs = {
  readonly frame: FigNode;
  readonly ctx: FigSymbolContext;
  readonly fontLoader: ReturnType<typeof createCachingFontLoader>;
  readonly dpr: number;
  readonly tolerate: boolean;
};

async function tryRenderFrame(args: RenderArgs): Promise<FrameRenderAttempt> {
  if (!args.frame.size) {
    throw new Error("tryRenderFrame: frame has no size");
  }
  if (
    !Number.isFinite(args.frame.size.x)
    || !Number.isFinite(args.frame.size.y)
    || args.frame.size.x <= 0
    || args.frame.size.y <= 0
  ) {
    // Resvg panics in native code on zero / non-finite dimensions.
    // Treat such frames as un-renderable rather than letting the panic
    // crash the host process.
    return { kind: "skipped", error: new Error(`frame "${args.frame.name ?? "?"}" has non-positive size`) };
  }
  try {
    return { kind: "rendered", frame: await renderOne(args) };
  } catch (error) {
    if (args.tolerate) {
      return { kind: "skipped", error };
    }
    throw error;
  }
}

async function renderOne(
  args: RenderArgs,
): Promise<{ readonly width: number; readonly height: number; readonly svg: string; readonly png: Uint8Array }> {
  const { frame, ctx, fontLoader, dpr } = args;
  if (!frame.size) {
    throw new Error("renderOne: frame has no size");
  }
  const result = await renderFigToSvg([frame], {
    width: frame.size.x,
    height: frame.size.y,
    ...figRawResources(ctx),
    normalizeRootTransform: true,
    fontLoader,
  });
  const svg = String(result.svg);
  const fitWidth = Math.max(1, Math.round(frame.size.x * dpr));
  const png = svgToPng(svg, fitWidth);
  return { width: frame.size.x, height: frame.size.y, svg, png };
}

function svgToPng(svg: string, width: number): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "transparent",
    font: { loadSystemFonts: true },
  });
  const png = resvg.render().asPng();
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}
