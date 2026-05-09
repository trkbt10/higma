/**
 * @file Materialise the visual workbench from an `Inventory`.
 *
 * The workbench is the agent's primary surface. For every fact in
 * the inventory it produces a PNG (or set of PNGs) the agent can
 * `Read`:
 *
 *   - clusters/<id>/contact-sheet.png  — every member of a cluster
 *     in one image, so the agent can decide name + variant.
 *   - clusters/<id>/members/<i>.png    — each clone individually.
 *   - palette/<key>.png                — colour swatch + an in-situ
 *     usage rendering so the agent sees how it appears in context.
 *   - typography/<key>.png             — sample render of a TEXT
 *     descriptor.
 *
 * The renderer panics on a small set of inputs (resvg native bug),
 * so every render is delegated to the long-lived subprocess worker
 * created by `worker-client.ts`. Failed renders are reported in the
 * manifest with an empty PNG path so the agent can still author a
 * decision for that entry.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdirSync as fsMkdirSync, writeFileSync as fsWriteFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { isItalic } from "@higma-document-models/fig/font";
import type { RefineSource } from "../refine-source/load";
import type { Inventory, SubtreeClusterEntry, PaletteEntry, TypographyEntry } from "../inventory";
import { createWorkerClient, type WorkerClient } from "../visual/worker-client";

export type BuildWorkbenchOptions = {
  readonly outDir: string;
  readonly figPath: string;
  /** Maximum raster width for member renders. Default 256. */
  readonly memberWidth?: number;
  /** Maximum raster width for typography samples. Default 512. */
  readonly sampleWidth?: number;
};

export type ClusterManifestEntry = {
  readonly clusterId: string;
  readonly roleSignature: string;
  readonly memberCount: number;
  readonly sizeClass: { readonly width: number; readonly height: number };
  readonly contactSheetPng: string;
  readonly members: readonly { readonly nodeGuid: string; readonly nodeName: string; readonly png: string }[];
};

export type PaletteManifestEntry = {
  readonly key: string;
  readonly hex: string;
  readonly usageCount: number;
  readonly bindEligibleCount: number;
  readonly existingProxyName: string | undefined;
  readonly swatchPng: string;
  readonly samplePng: string | undefined;
};

export type TypographyManifestEntry = {
  readonly key: string;
  readonly fontFamily: string;
  readonly fontStyle: string;
  readonly fontSize: number;
  readonly usageCount: number;
  readonly existingProxyName: string | undefined;
  readonly samplePng: string | undefined;
};

export type WorkbenchManifest = {
  readonly clusters: readonly ClusterManifestEntry[];
  readonly palette: readonly PaletteManifestEntry[];
  readonly typography: readonly TypographyManifestEntry[];
  readonly skipped: { readonly renderFailures: number };
};

/** Build the workbench. Renders go through a respawning subprocess worker. */
export async function buildWorkbench(
  source: RefineSource,
  inventory: Inventory,
  options: BuildWorkbenchOptions,
): Promise<WorkbenchManifest> {
  const { outDir, figPath, memberWidth = 256, sampleWidth = 512 } = options;
  await ensureDir(join(outDir, "clusters"));
  await ensureDir(join(outDir, "palette"));
  await ensureDir(join(outDir, "typography"));

  const worker = createWorkerClient(figPath);
  const skipped = { renderFailures: 0 };
  try {
    const clusters = await collectClusters(inventory.subtreeClusters, worker, join(outDir, "clusters"), memberWidth, skipped);
    const palette = await collectPalette(source, inventory.palette, worker, join(outDir, "palette"), memberWidth, skipped);
    const typography = collectTypography(inventory.typography, join(outDir, "typography"), sampleWidth);
    return { clusters, palette, typography, skipped };
  } finally {
    await worker.close();
  }
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

// ============================================================================
// Clusters
// ============================================================================

async function collectClusters(
  clusters: readonly SubtreeClusterEntry[],
  worker: WorkerClient,
  outDir: string,
  memberWidth: number,
  skipped: { renderFailures: number },
): Promise<readonly ClusterManifestEntry[]> {
  const out: ClusterManifestEntry[] = [];
  for (const cluster of clusters) {
    const dir = join(outDir, safeFsName(cluster.clusterId));
    const memberDir = join(dir, "members");
    await ensureDir(memberDir);
    const memberRenders: { nodeGuid: string; nodeName: string; png: string }[] = [];
    for (let i = 0; i < cluster.members.length; i = i + 1) {
      const m = cluster.members[i];
      if (!m) {
        continue;
      }
      const file = join(memberDir, `${i}.png`);
      const result = await worker.render({ nodeGuid: m.nodeGuid, maxWidth: memberWidth, outPath: file });
      if (result.kind === "ok") {
        memberRenders.push({ nodeGuid: m.nodeGuid, nodeName: m.nodeName, png: result.outPath });
      } else {
        skipped.renderFailures = skipped.renderFailures + 1;
      }
    }
    const contactPath = join(dir, "contact-sheet.png");
    const contactSheetPng = renderContactSheet(memberRenders, contactPath);
    await writeContactSheet(memberRenders, contactPath);
    out.push({
      clusterId: cluster.clusterId,
      roleSignature: cluster.roleSignature,
      memberCount: cluster.members.length,
      sizeClass: cluster.sizeClass,
      contactSheetPng,
      members: memberRenders,
    });
  }
  return out;
}

function renderContactSheet(
  members: readonly { readonly png: string }[],
  outPath: string,
): string {
  if (members.length === 0) {
    return "";
  }
  return outPath;
}

async function writeContactSheet(
  members: readonly { readonly png: string }[],
  outPath: string,
): Promise<void> {
  if (members.length === 0) {
    return;
  }
  const cellW = 256;
  const cellH = 192;
  const cols = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(members.length))));
  const rows = Math.ceil(members.length / cols);
  const totalW = cellW * cols;
  const totalH = cellH * rows;
  // Inline each member PNG as a base64 data URL — Resvg's image
  // handling is reliable on data: URLs and avoids the file:// path
  // resolution surprises that caused contact sheets to render blank.
  const cellPromises = members.map(async (m, i) => {
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    const buf = await readFileBytes(m.png);
    const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
    return `<image href="${dataUrl}" x="${x}" y="${y}" width="${cellW}" height="${cellH}" preserveAspectRatio="xMidYMid meet" />`;
  });
  const cells = (await Promise.all(cellPromises)).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}"><rect width="${totalW}" height="${totalH}" fill="#f5f5f5"/>${cells}</svg>`;
  const png = svgToPng(svg, totalW);
  await writeFile(outPath, png);
}

async function readFileBytes(path: string): Promise<Buffer> {
  return Buffer.from(await readFile(path));
}

// ============================================================================
// Palette
// ============================================================================

async function collectPalette(
  source: RefineSource,
  palette: readonly PaletteEntry[],
  worker: WorkerClient,
  outDir: string,
  memberWidth: number,
  skipped: { renderFailures: number },
): Promise<readonly PaletteManifestEntry[]> {
  const out: PaletteManifestEntry[] = [];
  for (const entry of palette) {
    const slug = safeFsName(entry.key.replace(/[^A-Za-z0-9]+/g, "_"));
    const dir = join(outDir, slug);
    await ensureDir(dir);
    const swatchPath = join(dir, "swatch.png");
    await writeFile(swatchPath, swatchPng(entry.hex));
    // In-situ sample: pick the first eligible usage's smallest enclosing
    // ancestor that we can render. Falls back to an empty string when
    // nothing renders cleanly.
    const samplePng = await renderInSituSampleIfAny(worker, source, entry, join(dir, "sample.png"), memberWidth, skipped);
    out.push({
      key: entry.key,
      hex: entry.hex,
      usageCount: entry.usages.length,
      bindEligibleCount: entry.usages.filter((u) => u.bindEligible).length,
      existingProxyName: entry.existingProxyName,
      swatchPng: swatchPath,
      samplePng,
    });
  }
  return out;
}

async function renderInSituSampleIfAny(
  worker: WorkerClient,
  source: RefineSource,
  entry: PaletteEntry,
  outPath: string,
  width: number,
  skipped: { renderFailures: number },
): Promise<string | undefined> {
  const sampleNode = pickPaletteSampleNodeGuid(source, entry);
  if (!sampleNode) {
    return undefined;
  }
  return tryRenderPaletteSample(worker, sampleNode, outPath, width, skipped);
}

async function tryRenderPaletteSample(
  worker: WorkerClient,
  nodeGuid: string,
  outPath: string,
  width: number,
  skipped: { renderFailures: number },
): Promise<string | undefined> {
  const result = await worker.render({ nodeGuid, maxWidth: width, outPath });
  if (result.kind === "ok") {
    return outPath;
  }
  skipped.renderFailures = skipped.renderFailures + 1;
  return undefined;
}

function pickPaletteSampleNodeGuid(source: RefineSource, entry: PaletteEntry): string | undefined {
  for (const u of entry.usages) {
    const node = source.nodesByGuid.get(u.nodeGuid);
    if (!node) {
      continue;
    }
    if (!node.size || node.size.x <= 0 || node.size.y <= 0) {
      continue;
    }
    return u.nodeGuid;
  }
  return undefined;
}

function swatchPng(hex: string): Uint8Array {
  const sanitised = hex.replace(/[^#0-9a-fA-F]/g, "");
  const fill = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(sanitised) ? sanitised : "#cccccc";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="160" viewBox="0 0 256 160"><rect width="256" height="160" fill="${fill}" stroke="#222" stroke-width="2"/></svg>`;
  return svgToPng(svg, 256);
}

// ============================================================================
// Typography
// ============================================================================

function collectTypography(
  typography: readonly TypographyEntry[],
  outDir: string,
  sampleWidth: number,
): readonly TypographyManifestEntry[] {
  const out: TypographyManifestEntry[] = [];
  for (const entry of typography) {
    const slug = safeFsName(entry.key.replace(/[^A-Za-z0-9]+/g, "_"));
    const dir = join(outDir, slug);
    // Sample is drawn synchronously via Resvg's native font support.
    // The descriptor's font may not be installed on this OS — in
    // that case Resvg substitutes silently and the agent reads the
    // sample with the substitution baked in (which is honest, since
    // any downstream render in this environment will substitute too).
    const samplePath = join(dir, "sample.png");
    const samplePng = renderTypographySample(entry, sampleWidth);
    if (samplePng) {
      mkdirSync(dir);
      writeSync(samplePath, samplePng);
      out.push({
        key: entry.key,
        fontFamily: entry.descriptor.fontFamily,
        fontStyle: entry.descriptor.fontStyle,
        fontSize: entry.descriptor.fontSize,
        usageCount: entry.usages.length,
        existingProxyName: entry.existingProxyName,
        samplePng: samplePath,
      });
    } else {
      out.push({
        key: entry.key,
        fontFamily: entry.descriptor.fontFamily,
        fontStyle: entry.descriptor.fontStyle,
        fontSize: entry.descriptor.fontSize,
        usageCount: entry.usages.length,
        existingProxyName: entry.existingProxyName,
        samplePng: undefined,
      });
    }
  }
  return out;
}

function renderTypographySample(entry: TypographyEntry, width: number): Uint8Array | undefined {
  const sample = entry.usages.find((u) => u.characterCount > 0)?.characters
    ?? `${entry.descriptor.fontFamily} ${entry.descriptor.fontStyle} ${entry.descriptor.fontSize}px`;
  // Modest height: one line at the given fontSize plus padding.
  const fontSize = entry.descriptor.fontSize;
  const padding = 16;
  const height = Math.max(48, Math.round(fontSize * 1.5) + padding * 2);
  const escaped = escapeXml(sample);
  const family = escapeXml(entry.descriptor.fontFamily);
  const style = entry.descriptor.fontStyle;
  const weight = entry.descriptor.fontWeight;
  // Italic detection routes through the canonical `isItalic` SoT so
  // a workbench preview never disagrees with the renderer's resolver
  // about whether a style string asks for italic.
  const fontStyleAttr = isItalic(style) ? "italic" : "normal";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="${width}" height="${height}" fill="#ffffff"/>`
    + `<text x="${padding}" y="${padding + Math.round(fontSize)}" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" font-style="${fontStyleAttr}" fill="#111">${escaped}</text>`
    + `</svg>`;
  return svgToPng(svg, width);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ============================================================================
// IO helpers
// ============================================================================

/**
 * Some cluster ids include the full role signature, which can run
 * past 1000 characters. Filesystems on macOS / Linux cap component
 * length at ~255 bytes, so we hash any long id and prefix with a
 * short readable head taken from the original id (so directories
 * still hint at the cluster type when scanned in `ls`).
 */
function safeFsName(id: string): string {
  if (id.length <= 80) {
    return id;
  }
  const head = id.slice(0, 40);
  const digest = createHash("sha1").update(id).digest("hex").slice(0, 12);
  return `${head}__${digest}`;
}

function svgToPng(svg: string, width: number): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "#ffffff",
    font: { loadSystemFonts: true },
  });
  const png = resvg.render().asPng();
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}

function mkdirSync(path: string): void {
  fsMkdirSync(path, { recursive: true });
}

function writeSync(path: string, data: Uint8Array): void {
  fsWriteFileSync(path, data);
}
