/**
 * @file Render every renderable top-level FRAME in a `.fig` file via
 * the long-lived subprocess worker.
 *
 * Why: native resvg can panic on a small set of inputs and that
 * panic is not catchable from JS. The in-process `renderFrames`
 * works for files where every frame happens to render cleanly, but
 * the moment one frame panics the entire verify run dies. Routing
 * each top-level frame's render through the worker isolates the
 * panic to a single subprocess invocation; we respawn and continue.
 */
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createFigDocumentContext } from "@higma-document-io/fig/context";
import { getNodeType, guidToString } from "@higma-document-models/fig/domain";
import type { FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import { createWorkerClient } from "./worker-client";

export type WorkerRenderedFrame = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly png: Uint8Array;
};

export type RenderFramesViaWorkerOptions = {
  readonly figPath: string;
  /** Maximum raster width per frame. Default 720. */
  readonly maxWidth?: number;
  readonly onSkipFrame?: (name: string, error: unknown) => void;
};

/**
 * Discover every renderable top-level FRAME, ask the worker to render
 * each one to a temp PNG, and return the bytes.
 * Frames whose rendering fails (typically a native panic) are
 * reported via `onSkipFrame` and excluded from the result.
 */
export async function renderFramesViaWorker(
  options: RenderFramesViaWorkerOptions,
): Promise<readonly WorkerRenderedFrame[]> {
  const { figPath, maxWidth = 720, onSkipFrame } = options;
  const bytes = new Uint8Array(await readFile(figPath));
  // Build the SoT context just to enumerate top-level frames. The
  // worker subprocess loads its own copy from `figPath` and consumes
  // the same SoT internally — we don't pass the context across the
  // process boundary.
  const ctx = await createFigDocumentContext(bytes);
  const frames = discoverTopLevelFrames(ctx.document);

  const tmpRoot = join(tmpdir(), `refine-fig-verify-${process.pid}-${Date.now()}`);
  await mkdir(tmpRoot, { recursive: true });

  const worker = createWorkerClient(figPath);
  try {
    const out: WorkerRenderedFrame[] = [];
    for (const frame of frames) {
      if (!frame.node.size) {
        continue;
      }
      const outPath = join(tmpRoot, `${frame.guid.replace(":", "_")}.png`);
      const result = await worker.render({ nodeGuid: frame.guid, maxWidth, outPath });
      if (result.kind === "failed") {
        onSkipFrame?.(frame.name, new Error(result.error));
        continue;
      }
      const png = new Uint8Array(await readFile(outPath));
      out.push({ name: frame.name, width: frame.node.size.x, height: frame.node.size.y, png });
    }
    return out;
  } finally {
    await worker.close();
  }
}

type DiscoveredFrame = {
  readonly guid: string;
  readonly name: string;
  readonly node: FigNode;
};

function discoverTopLevelFrames(document: FigKiwiDocumentIndex): readonly DiscoveredFrame[] {
  const out: DiscoveredFrame[] = [];
  for (const root of document.roots) {
    if (getNodeType(root) !== "DOCUMENT") {
      continue;
    }
    for (const canvas of document.childrenOf(root)) {
      if (getNodeType(canvas) !== "CANVAS" || canvas.internalOnly === true || canvas.visible === false) {
        continue;
      }
      for (const frame of document.childrenOf(canvas)) {
        const t = getNodeType(frame);
        if (t !== "FRAME") {
          continue;
        }
        out.push({
          guid: guidToString(frame.guid),
          name: `${canvas.name ?? "(unnamed)"} / ${frame.name ?? "(unnamed)"}`,
          node: frame,
        });
      }
    }
  }
  return out;
}
