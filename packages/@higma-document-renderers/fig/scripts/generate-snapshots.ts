/**
 * @file Generate SVG snapshots from .fig files
 *
 * Usage: bun packages/@higma-document-renderers/fig/scripts/generate-snapshots.ts [scope]
 *
 * Example:
 *   bun packages/@higma-document-renderers/fig/scripts/generate-snapshots.ts text-comprehensive
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createFigDocumentContextFromNodeChanges, figDocumentResources } from "@higma-document-io/fig";
import { parseFigFile } from "@higma-document-io/fig/parser";
import { findNodesByType, getNodeType, guidToString } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import { renderCanvas, renderFigToSvg } from "../src/svg/renderer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "../fixtures");

function getNodeSize(node: FigNode): { width: number; height: number } {
  const size = node.size;
  if (size === undefined || size.x === undefined || size.y === undefined) {
    throw new Error(`Snapshot generation requires size for node "${node.name ?? "<unnamed>"}"`);
  }
  return { width: size.x, height: size.y };
}

function getNodeViewport(node: FigNode, width: number, height: number): { x: number; y: number; width: number; height: number } {
  const transform = node.transform;
  if (transform === undefined) {
    throw new Error(`Snapshot generation requires transform for node "${node.name ?? "<unnamed>"}"`);
  }
  return {
    x: transform.m02 ?? 0,
    y: transform.m12 ?? 0,
    width,
    height,
  };
}

function getNodeGuidKey(node: FigNode): string {
  const guid = node.guid;
  if (guid === undefined) {
    throw new Error(`Snapshot generation requires GUID for node "${node.name ?? "<unnamed>"}"`);
  }
  return guidToString(guid);
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
}

/**
 * Find the .fig file in a fixture directory
 * Looks for [scope].fig or [scope]_*.fig
 */
function findFigFile(scopeDir: string, scope: string): string | null {
  const files = fs.readdirSync(scopeDir);

  // First try exact match
  const exactMatch = files.find((f) => f === `${scope}.fig`);
  if (exactMatch) {return path.join(scopeDir, exactMatch);}

  // Try with underscore variant (e.g., my-scope -> my_scope.fig)
  const underscoreScope = scope.replace(/-/g, "_");
  const underscoreMatch = files.find((f) => f === `${underscoreScope}.fig`);
  if (underscoreMatch) {return path.join(scopeDir, underscoreMatch);}

  // Try any .fig file
  const anyFig = files.find((f) => f.endsWith(".fig"));
  if (anyFig) {return path.join(scopeDir, anyFig);}

  return null;
}

async function generateSnapshots(scope: string) {
  const scopeDir = path.join(FIXTURES_DIR, scope);

  if (!fs.existsSync(scopeDir)) {
    console.error(`Fixture directory not found: ${scopeDir}`);
    console.log("\nAvailable fixtures:");
    const dirs = fs.readdirSync(FIXTURES_DIR).filter((d) => fs.statSync(path.join(FIXTURES_DIR, d)).isDirectory());
    dirs.forEach((d) => console.log(`  - ${d}`));
    process.exit(1);
  }

  const figPath = findFigFile(scopeDir, scope);
  if (!figPath) {
    console.error(`No .fig file found in ${scopeDir}`);
    process.exit(1);
  }

  console.log(`Loading ${path.basename(figPath)}...`);
  const data = fs.readFileSync(figPath);
  const parsed = await parseFigFile(new Uint8Array(data));
  const context = createFigDocumentContextFromNodeChanges({
    nodeChanges: parsed.nodeChanges,
    blobs: parsed.blobs,
    images: parsed.images,
    metadata: null,
  });
  const resources = figDocumentResources(context);

  console.log(`Indexing Kiwi document (${parsed.nodeChanges.length} nodes)...`);

  // Find all CANVAS (page) nodes
  const canvases = findNodesByType(resources.document, "CANVAS");
  console.log(`Found ${canvases.length} pages, ${resources.blobs.length} blobs\n`);

  // Output directory is fixtures/[scope]/snapshots/
  const outDir = path.join(scopeDir, "snapshots");
  fs.mkdirSync(outDir, { recursive: true });

  // Generate manifest
  const manifest: {
    fixture: string;
    generatedAt: string;
    pages: Array<{
      name: string;
      file: string;
      elements: Array<{ name: string; file: string; type: string }>;
    }>;
  } = {
    fixture: scope,
    generatedAt: new Date().toISOString(),
    pages: [],
  };

  for (const canvas of canvases) {
    const pageName = canvas.name ?? "unnamed";
    const pageFilename = sanitizeFilename(pageName);

    console.log(`Page: "${pageName}"`);

    const pageEntry: (typeof manifest.pages)[0] = {
      name: pageName,
      file: `${pageFilename}.svg`,
      elements: [],
    };

    // Render full page
    const pageResult = await renderCanvas(canvas, {
      width: 1200,
      height: 800,
      blobs: resources.blobs,
      images: resources.images,
      childrenOf: resources.childrenOf,
      symbolResolver: resources.symbolResolver,
      styleRegistry: resources.styleRegistry,
    });
    const pageSvgPath = path.join(outDir, `${pageFilename}.svg`);
    fs.writeFileSync(pageSvgPath, pageResult.svg);
    console.log(`  -> ${pageFilename}.svg (${pageResult.warnings.length} warnings)`);

    // Render individual top-level elements
    const children = resources.childrenOf(canvas);
    for (const child of children) {
      const elemName = child.name ?? "unnamed";
      const elemType = getNodeType(child);
      const size = getNodeSize(child);
      const guidStr = sanitizeFilename(getNodeGuidKey(child));

      const elemFilename = `${pageFilename}--${sanitizeFilename(elemName)}--${guidStr}`;

      const width = Math.max(size.width, 100);
      const height = Math.max(size.height, 100);
      const elemResult = await renderFigToSvg([child], {
        width,
        height,
        viewport: getNodeViewport(child, width, height),
        blobs: resources.blobs,
        images: resources.images,
        childrenOf: resources.childrenOf,
        symbolResolver: resources.symbolResolver,
        styleRegistry: resources.styleRegistry,
      });

      const elemSvgPath = path.join(outDir, `${elemFilename}.svg`);
      fs.writeFileSync(elemSvgPath, elemResult.svg);

      pageEntry.elements.push({
        name: elemName,
        file: `${elemFilename}.svg`,
        type: elemType,
      });

      console.log(`    - [${elemType}] "${elemName}" -> ${elemFilename}.svg`);
    }

    manifest.pages.push(pageEntry);
    console.log("");
  }

  // Write manifest
  const manifestPath = path.join(outDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Manifest: ${manifestPath}`);

  console.log(`\nDone! Snapshots saved to: ${outDir}`);
}

// Main
const scope = process.argv[2];
if (!scope) {
  console.log("Usage: bun packages/@higma-document-renderers/fig/scripts/generate-snapshots.ts [scope]");
  console.log("\nAvailable fixtures:");
  const dirs = fs.readdirSync(FIXTURES_DIR).filter((d) => fs.statSync(path.join(FIXTURES_DIR, d)).isDirectory());
  dirs.forEach((d) => console.log(`  - ${d}`));
  process.exit(1);
}

generateSnapshots(scope);
