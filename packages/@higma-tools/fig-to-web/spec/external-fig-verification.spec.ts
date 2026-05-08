/**
 * @file Integration verification harness — exercise the full
 * fig-to-web pipeline (load → tokens → registry → emit → render) against
 * one or more externally supplied `.fig` files.
 *
 * Verification only. The harness deliberately does not bundle a fixture
 * into the repository. The path is supplied at invocation time via either:
 *
 *   FIG_TO_WEB_VERIFY_FIG=/abs/path/to/file.fig          (single file)
 *   FIG_TO_WEB_VERIFY_FIG_DIR=/abs/path/to/dir-of-figs   (every *.fig in a dir)
 *
 * Both env vars may be set together; their union is verified. When
 * neither is set the whole `describe` is skipped so a CI run without an
 * external .fig path stays green.
 *
 * The assertions form a cross-cutting consistency check that the
 * focused unit specs cannot reach on their own:
 *
 *   - registry coverage of every emitted file (one TSX per frame and
 *     per referenced component, no orphan files);
 *   - `EmitFile.path` uniqueness across the entire emit (collisions
 *     would silently overwrite generated pages on disk);
 *   - cross-file React import resolution inside generated TSX (a page
 *     that imports `./components/design/button` must point at an
 *     emitted file whose default-export name matches the imported
 *     identifier);
 *   - asset URL ↔ collected-bytes round-trip (every
 *     `./assets/<hash>.<ext>` URL referenced by the JSX has a matching
 *     entry in `EmitResult.assets`, and vice-versa);
 *   - `var(--token)` references in TSX resolve to a `--token:` line in
 *     the generated `tokens.css`;
 *   - variant-set ↔ prop-decl coherence (a component target whose
 *     `variants.size > 0` must declare a `kind:"variant"` prop whose
 *     `values` array equals `[...variants.keys()]`, and the rendered
 *     TSX must `switch` on every key);
 *   - INSTANCE → ComponentTarget resolution: every INSTANCE descendant
 *     of a selected frame whose `symbolID` resolves to an in-source
 *     SYMBOL must end up registered in `EmitRegistry.components`.
 *
 * These are exactly the contracts that drift silently when one half of
 * the pipeline is edited without the other; pinning them against a
 * real-world Figma file is the cheapest way to keep the regression
 * surface tight.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildRegistry,
  buildTokensFromFrames,
  emitFromFrames,
  listFrameTargets,
  loadFigSource,
  tokensToCss,
} from "../src";
import type {
  ColorToken,
  ComponentTarget,
  EmitFile,
  EmitRegistry,
  EmitResult,
  FigSource,
  FrameTarget,
  RadiusToken,
  ShadowToken,
  SpacingToken,
  TokenSet,
  TypographyToken,
} from "../src";
import { lookupInstanceTarget, variantValueForInstance } from "../src/emit";

import type { FigNode } from "@higma-document-models/fig/types";
import { getNodeType, guidToString, safeChildren } from "@higma-document-models/fig/domain";

// =============================================================================
// External .fig discovery
// =============================================================================

const ENV_SINGLE_FIG = "FIG_TO_WEB_VERIFY_FIG";
const ENV_DIR_OF_FIGS = "FIG_TO_WEB_VERIFY_FIG_DIR";

function listFigsInDir(dir: string): readonly string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  if (!fs.statSync(dir).isDirectory()) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.toLowerCase().endsWith(".fig"))
    .sort()
    .map((entry) => path.resolve(dir, entry));
}

function dedupePaths(paths: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (seen.has(p)) {
      continue;
    }
    seen.add(p);
    out.push(p);
  }
  return out;
}

function discoverFigPaths(): readonly string[] {
  const collected: string[] = [];
  const single = process.env[ENV_SINGLE_FIG];
  if (single && fs.existsSync(single)) {
    collected.push(path.resolve(single));
  }
  const dir = process.env[ENV_DIR_OF_FIGS];
  if (dir) {
    collected.push(...listFigsInDir(dir));
  }
  return dedupePaths(collected);
}

// =============================================================================
// Pipeline driver
// =============================================================================

type PipelineResult = {
  readonly figPath: string;
  readonly source: FigSource;
  readonly canvases: readonly FigNode[];
  readonly canvasName: string;
  readonly canvas: FigNode;
  readonly frames: readonly FigNode[];
  readonly tokens: TokenSet;
  readonly registry: EmitRegistry;
  readonly emitResult: EmitResult;
  readonly fileByPath: ReadonlyMap<string, EmitFile>;
};

function listUserVisibleCanvases(source: FigSource): readonly FigNode[] {
  const out: FigNode[] = [];
  for (const root of source.tree.roots) {
    if (getNodeType(root) !== "DOCUMENT") {
      continue;
    }
    for (const child of safeChildren(root)) {
      if (getNodeType(child) === "CANVAS" && child.internalOnly !== true) {
        out.push(child);
      }
    }
  }
  return out;
}

function pickCanvasWithFrames(canvases: readonly FigNode[]): FigNode | undefined {
  for (const canvas of canvases) {
    if (listFrameTargets(canvas).length > 0) {
      return canvas;
    }
  }
  return undefined;
}

async function runPipeline(figPath: string): Promise<PipelineResult> {
  const buffer = await fs.promises.readFile(figPath);
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const source = await loadFigSource(bytes);
  const canvases = listUserVisibleCanvases(source);
  const canvas = pickCanvasWithFrames(canvases);
  if (!canvas) {
    throw new Error(
      `fig file "${figPath}" has no user-visible CANVAS with frame-like top-level children — pipeline cannot proceed`,
    );
  }
  const frames = listFrameTargets(canvas);
  const built = buildTokensFromFrames(source, frames);
  const registry = buildRegistry(source, frames);
  const emitResult = await emitFromFrames(source, frames, { debugAttrs: false });
  const fileByPath = new Map(emitResult.files.map((file): [string, EmitFile] => [file.path, file]));
  return {
    figPath,
    source,
    canvases,
    canvasName: canvas.name ?? "(unnamed)",
    canvas,
    frames,
    tokens: built.tokens,
    registry,
    emitResult,
    fileByPath,
  };
}

// =============================================================================
// Generic helpers
// =============================================================================

type Ref<T> = { value: T | null };

function requireState<T>(ref: Ref<T>): T {
  if (ref.value === null) {
    throw new Error("verification pipeline state was not initialised by beforeAll");
  }
  return ref.value;
}

function collectInstancesIn(node: FigNode, out: FigNode[]): void {
  if (getNodeType(node) === "INSTANCE") {
    out.push(node);
  }
  for (const child of safeChildren(node)) {
    collectInstancesIn(child, out);
  }
}

function collectAllDescendants(node: FigNode, out: FigNode[]): void {
  out.push(node);
  for (const child of safeChildren(node)) {
    collectAllDescendants(child, out);
  }
}

function unique<T>(items: readonly T[]): readonly T[] {
  return [...new Set(items)];
}

function findDuplicates<T>(items: readonly T[], keyOf: (item: T) => string): readonly string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const [key, count] of counts) {
    if (count > 1) {
      out.push(`${key} (×${count})`);
    }
  }
  return out;
}

// =============================================================================
// TSX surface inspection
// =============================================================================

const NAMED_IMPORT_PATTERN = /import\s*\{\s*([^}]+)\s*\}\s*from\s*["']([^"']+)["']/g;
const NAMESPACE_IMPORT_PATTERN = /import\s*\*\s*as\s+(\w+)\s*from\s*["']([^"']+)["']/g;
const ASSET_URL_PATTERN = /\.\/assets\/([0-9a-f]+)\.([a-z0-9]+)/gi;
const TOKEN_VAR_PATTERN = /var\(\s*--([\w-]+)\s*\)/g;

type RelativeImport = {
  readonly fromFile: string;
  readonly importPath: string;
  readonly names: readonly string[];
};

function parseRelativeNamedImports(file: EmitFile): readonly RelativeImport[] {
  const out: RelativeImport[] = [];
  for (const match of file.contents.matchAll(NAMED_IMPORT_PATTERN)) {
    // Both capture groups in `NAMED_IMPORT_PATTERN` are required.
    // Throwing when one is missing surfaces a regex / capture-group
    // desync immediately — defaulting to `""` would silently emit
    // `import {} from ""` and pass the downstream `startsWith(".")`
    // check by short-circuiting, hiding the parse failure.
    const namesRaw = match[1];
    const importPath = match[2];
    if (namesRaw === undefined || importPath === undefined) {
      throw new Error(
        `spec parser: NAMED_IMPORT_PATTERN matched "${match[0]}" but a capture group was missing`,
      );
    }
    if (!importPath.startsWith(".")) {
      continue;
    }
    const names = namesRaw
      .split(",")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .map(stripAsAlias);
    out.push({ fromFile: file.path, importPath, names });
  }
  for (const match of file.contents.matchAll(NAMESPACE_IMPORT_PATTERN)) {
    const importPath = match[2];
    if (importPath === undefined) {
      throw new Error(
        `spec parser: NAMESPACE_IMPORT_PATTERN matched "${match[0]}" but capture group 2 was missing`,
      );
    }
    if (!importPath.startsWith(".")) {
      continue;
    }
    out.push({ fromFile: file.path, importPath, names: [] });
  }
  return out;
}

/**
 * Strip an `as alias` suffix from a single named-import segment.
 * `"X as Y"` → `"X"`. The non-alias path is the identity. `String#split`
 * with a non-empty input always returns at least one element so the
 * first slot is unconditionally `string`.
 */
function stripAsAlias(segment: string): string {
  const parts = segment.split(/\s+as\s+/);
  const head = parts[0];
  if (head === undefined) {
    throw new Error(`spec parser: stripAsAlias("${segment}") produced an empty split — should be unreachable`);
  }
  return head.trim();
}

function resolveImportCandidatePaths(fromFile: string, importPath: string): readonly string[] {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), importPath));
  return [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`];
}

function tsxFiles(files: readonly EmitFile[]): readonly EmitFile[] {
  return files.filter((file) => file.path.endsWith(".tsx"));
}

function namedExportPattern(name: string): RegExp {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`export\\s+(?:async\\s+)?function\\s+${safe}\\b|export\\s+default\\s+${safe}\\b|export\\s*\\{[^}]*\\b${safe}\\b[^}]*\\}|export\\s+(?:const|class|type|interface)\\s+${safe}\\b`);
}

function fileDeclaresExport(file: EmitFile, name: string): boolean {
  return namedExportPattern(name).test(file.contents);
}

function collectAssetUrls(file: EmitFile): readonly string[] {
  const out: string[] = [];
  for (const match of file.contents.matchAll(ASSET_URL_PATTERN)) {
    out.push(`assets/${match[1]}.${match[2]}`);
  }
  return out;
}

function collectTokenRefs(file: EmitFile): readonly string[] {
  const out: string[] = [];
  for (const match of file.contents.matchAll(TOKEN_VAR_PATTERN)) {
    if (match[1]) {
      out.push(match[1]);
    }
  }
  return out;
}

function collectTokenDeclarations(css: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const match of css.matchAll(/--([\w-]+)\s*:/g)) {
    if (match[1]) {
      out.add(match[1]);
    }
  }
  return out;
}

// =============================================================================
// Assertion helpers shared across `it` blocks
// =============================================================================

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function checkColorToken(token: ColorToken): readonly string[] {
  const issues: string[] = [];
  const { r, g, b, a } = token.value;
  for (const [name, value] of [["r", r], ["g", g], ["b", b], ["a", a]] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      issues.push(`color "${token.id}" channel ${name}=${value} not in [0,1]`);
    }
  }
  if (token.id.length === 0) {
    issues.push(`color token has empty id`);
  }
  return issues;
}

function checkTypographyToken(token: TypographyToken): readonly string[] {
  const issues: string[] = [];
  if (token.id.length === 0) {
    issues.push(`typography token has empty id`);
  }
  if (token.fontFamily.length === 0) {
    issues.push(`typography "${token.id}" has empty fontFamily`);
  }
  if (!(Number.isFinite(token.fontSize) && token.fontSize > 0)) {
    issues.push(`typography "${token.id}" fontSize ${token.fontSize} is not positive`);
  }
  return issues;
}

function checkSpacingOrRadiusToken(label: "spacing" | "radius", token: SpacingToken | RadiusToken): readonly string[] {
  const issues: string[] = [];
  if (!isFiniteNonNegative(token.value)) {
    issues.push(`${label} "${token.id}" value ${token.value} is not finite-and-non-negative`);
  }
  return issues;
}

function checkShadowToken(token: ShadowToken): readonly string[] {
  if (token.cssValue.trim().length === 0) {
    return [`shadow "${token.id}" has empty cssValue`];
  }
  return [];
}

function checkVariantCoherence(target: ComponentTarget): readonly string[] {
  if (target.variants.size === 0) {
    return [];
  }
  const issues: string[] = [];
  const variantKeys = [...target.variants.keys()];
  const variantDecl = target.props.find((prop) => prop.kind === "variant");
  if (!variantDecl) {
    issues.push(`component "${target.componentName}" has variants but no kind="variant" prop decl`);
    return issues;
  }
  const declaredValues = new Set(variantDecl.kind === "variant" ? variantDecl.values : []);
  const sourceValues = new Set(variantKeys);
  const missing = [...sourceValues].filter((v) => !declaredValues.has(v));
  if (missing.length > 0) {
    issues.push(
      `component "${target.componentName}" variant prop omits values [${missing.join(", ")}]`,
    );
  }
  const stray = [...declaredValues].filter((v) => !sourceValues.has(v));
  if (stray.length > 0) {
    issues.push(
      `component "${target.componentName}" variant prop declares unknown values [${stray.join(", ")}]`,
    );
  }
  return issues;
}

function checkVariantSwitchInTsx(file: EmitFile, target: ComponentTarget): readonly string[] {
  if (target.variants.size === 0) {
    return [];
  }
  const issues: string[] = [];
  if (!file.contents.includes("switch (variant)")) {
    issues.push(`component "${target.componentName}" TSX is missing the variant switch statement`);
  }
  for (const key of target.variants.keys()) {
    const caseLine = `case ${JSON.stringify(key)}:`;
    if (!file.contents.includes(caseLine)) {
      issues.push(`component "${target.componentName}" TSX has no \`${caseLine}\``);
    }
  }
  return issues;
}

// =============================================================================
// Entry
// =============================================================================

const FIG_PATHS = discoverFigPaths();

if (FIG_PATHS.length === 0) {
  describe.skip(
    `fig-to-web verification — set ${ENV_SINGLE_FIG} or ${ENV_DIR_OF_FIGS} to enable`,
    () => {
      it("skipped — no external .fig path provided", () => {
        // Intentionally empty: the harness only runs against externally
        // supplied .fig paths so the repository tree stays free of
        // verification fixtures.
      });
    },
  );
} else {
  for (const figPath of FIG_PATHS) {
    describeFigPath(figPath);
  }
}

function describeFigPath(figPath: string): void {
  const figName = path.basename(figPath);
  describe(`fig-to-web verification — ${figName}`, () => {
    const stateRef: Ref<PipelineResult> = { value: null };

    beforeAll(async () => {
      stateRef.value = await runPipeline(figPath);
    }, 240_000);

    it("loads source and discovers at least one user-visible canvas with frame-like children", () => {
      const state = requireState(stateRef);
      expect(state.canvases.length, `expected ≥1 user-visible CANVAS in ${figName}`).toBeGreaterThan(0);
      expect(
        state.frames.length,
        `expected ≥1 frame target on canvas "${state.canvasName}"`,
      ).toBeGreaterThan(0);
      expect(state.source.nodesByGuid.size).toBeGreaterThan(0);
    });

    it("registers exactly one frame target per input frame", () => {
      const state = requireState(stateRef);
      expect(state.registry.frames.size).toBe(state.frames.length);
      for (const frame of state.frames) {
        const target = state.registry.frames.get(guidToString(frame.guid));
        expect(target, `frame "${frame.name}" missing from registry`).toBeDefined();
      }
    });

    it("produces well-formed token tables", () => {
      const state = requireState(stateRef);
      const issues: string[] = [];
      for (const token of state.tokens.colors.values()) {
        issues.push(...checkColorToken(token));
      }
      for (const token of state.tokens.typography.values()) {
        issues.push(...checkTypographyToken(token));
      }
      for (const token of state.tokens.spacing.values()) {
        issues.push(...checkSpacingOrRadiusToken("spacing", token));
      }
      for (const token of state.tokens.radii.values()) {
        issues.push(...checkSpacingOrRadiusToken("radius", token));
      }
      for (const token of state.tokens.shadows.values()) {
        issues.push(...checkShadowToken(token));
      }
      expect(issues, issues.join("\n")).toEqual([]);
    });

    it("emits the fixed top-level files (tokens.css, index.html, main.tsx, App.tsx, preview.css, index.ts) exactly once", () => {
      const state = requireState(stateRef);
      const required: readonly string[] = [
        "tokens.css",
        "index.html",
        "main.tsx",
        "App.tsx",
        "preview.css",
        "index.ts",
      ];
      for (const filename of required) {
        const matches = state.emitResult.files.filter((file) => file.path === filename);
        expect(matches.length, `expected exactly one ${filename}`).toBe(1);
      }
    });

    it("emits one TSX per registered frame and per registered component", () => {
      const state = requireState(stateRef);
      for (const target of state.registry.frames.values()) {
        const file = state.fileByPath.get(target.filePath);
        expect(
          file,
          `expected page TSX at ${target.filePath} for frame "${target.node.name}"`,
        ).toBeDefined();
      }
      for (const target of state.registry.components.values()) {
        const file = state.fileByPath.get(target.filePath);
        expect(
          file,
          `expected component TSX at ${target.filePath} for "${target.node.name}"`,
        ).toBeDefined();
      }
    });

    it("emits one figma SVG and one figma HTML per frame target whose node.size exists", () => {
      const state = requireState(stateRef);
      const sizedFrames = [...state.registry.frames.values()].filter(
        (target): target is FrameTarget => target.node.size !== undefined,
      );
      const svgFiles = state.emitResult.files.filter((file) => file.path.startsWith("figma/") && file.path.endsWith(".svg"));
      const htmlFiles = state.emitResult.files.filter((file) => file.path.startsWith("figma/") && file.path.endsWith(".html"));
      expect(svgFiles.length).toBe(sizedFrames.length);
      expect(htmlFiles.length).toBe(sizedFrames.length);
      const svgPaths = new Set(svgFiles.map((file) => file.path.replace(/\.svg$/, "")));
      const htmlPaths = new Set(htmlFiles.map((file) => file.path.replace(/\.html$/, "")));
      const svgWithoutHtml = [...svgPaths].filter((p) => !htmlPaths.has(p));
      const htmlWithoutSvg = [...htmlPaths].filter((p) => !svgPaths.has(p));
      expect(svgWithoutHtml).toEqual([]);
      expect(htmlWithoutSvg).toEqual([]);
    });

    it("every emitted file path is unique", () => {
      const state = requireState(stateRef);
      const duplicates = findDuplicates(state.emitResult.files, (file) => file.path);
      expect(duplicates, `duplicate emit paths: ${duplicates.join(", ")}`).toEqual([]);
    });

    it("every emitted asset path is unique", () => {
      const state = requireState(stateRef);
      const duplicates = findDuplicates(state.emitResult.assets, (asset) => asset.path);
      expect(duplicates, `duplicate asset paths: ${duplicates.join(", ")}`).toEqual([]);
    });

    it("every page and component TSX has the React boilerplate", () => {
      const state = requireState(stateRef);
      const issues: string[] = [];
      for (const target of state.registry.frames.values()) {
        issues.push(...checkTsxBoilerplate(state.fileByPath, target.filePath, target.componentName));
      }
      for (const target of state.registry.components.values()) {
        issues.push(...checkTsxBoilerplate(state.fileByPath, target.filePath, target.componentName));
      }
      expect(issues, issues.join("\n")).toEqual([]);
    });

    it("every variant-set component declares a variant prop and switches on every variant key", () => {
      const state = requireState(stateRef);
      const issues: string[] = [];
      for (const target of state.registry.components.values()) {
        issues.push(...checkVariantCoherence(target));
        const file = state.fileByPath.get(target.filePath);
        if (!file) {
          issues.push(`component target "${target.componentName}" has no emitted TSX file at ${target.filePath}`);
          continue;
        }
        issues.push(...checkVariantSwitchInTsx(file, target));
      }
      expect(issues, issues.join("\n")).toEqual([]);
    });

    it("every relative TSX import resolves to another emitted TSX file (and the named identifier is exported there)", () => {
      const state = requireState(stateRef);
      const issues: string[] = [];
      for (const file of tsxFiles(state.emitResult.files)) {
        for (const imp of parseRelativeNamedImports(file)) {
          const candidates = resolveImportCandidatePaths(imp.fromFile, imp.importPath);
          const resolvedPath = candidates.find((candidate) => state.fileByPath.has(candidate));
          if (!resolvedPath) {
            issues.push(
              `${file.path} imports "${imp.importPath}" → no matching emitted file (tried ${candidates.join(", ")})`,
            );
            continue;
          }
          const resolvedFile = state.fileByPath.get(resolvedPath);
          if (!resolvedFile) {
            continue;
          }
          for (const name of imp.names) {
            if (!fileDeclaresExport(resolvedFile, name)) {
              issues.push(
                `${file.path} imports { ${name} } from "${imp.importPath}" → ${resolvedFile.path} does not declare an export named "${name}"`,
              );
            }
          }
        }
      }
      expect(issues, issues.join("\n")).toEqual([]);
    });

    it("every ./assets/<hash>.<ext> URL referenced by emitted files has a matching asset entry", () => {
      const state = requireState(stateRef);
      const declaredAssets = new Set(state.emitResult.assets.map((asset) => asset.path));
      const issues: string[] = [];
      for (const file of state.emitResult.files) {
        for (const url of unique(collectAssetUrls(file))) {
          if (!declaredAssets.has(url)) {
            issues.push(`${file.path} references ${url} but no matching asset bytes were collected`);
          }
        }
      }
      expect(issues, issues.join("\n")).toEqual([]);
    });

    it("every collected asset is referenced from at least one emitted file", () => {
      const state = requireState(stateRef);
      const referenced = new Set<string>();
      for (const file of state.emitResult.files) {
        for (const url of collectAssetUrls(file)) {
          referenced.add(url);
        }
      }
      const orphans = state.emitResult.assets
        .map((asset) => asset.path)
        .filter((p) => !referenced.has(p));
      expect(orphans, `unreferenced collected assets: ${orphans.join(", ")}`).toEqual([]);
    });

    it("every var(--token) reference in TSX matches a CSS variable declared in tokens.css", () => {
      const state = requireState(stateRef);
      const tokensCss = state.fileByPath.get("tokens.css");
      expect(tokensCss).toBeDefined();
      if (!tokensCss) {
        return;
      }
      const declared = collectTokenDeclarations(tokensCss.contents);
      const issues: string[] = [];
      for (const file of tsxFiles(state.emitResult.files)) {
        for (const ref of unique(collectTokenRefs(file))) {
          if (!declared.has(ref)) {
            issues.push(`${file.path} references var(--${ref}) but tokens.css does not declare it`);
          }
        }
      }
      expect(issues, issues.join("\n")).toEqual([]);
    });

    it("tokens.css regenerated from the same TokenSet matches the emitted tokens.css", () => {
      const state = requireState(stateRef);
      const tokensCss = state.fileByPath.get("tokens.css");
      expect(tokensCss).toBeDefined();
      if (!tokensCss) {
        return;
      }
      // Round-trip: the CSS the orchestrator wrote must be exactly what
      // `tokensToCss(tokens)` produces from the same TokenSet. If a
      // future refactor desyncs these two paths, var(--token)
      // references inside JSX would silently miss declarations that
      // never landed in the file.
      const regenerated = tokensToCss(state.tokens);
      expect(tokensCss.contents).toBe(regenerated);
    });

    it("every INSTANCE in selected frames whose symbol resolves in the source is registered as a ComponentTarget", () => {
      const state = requireState(stateRef);
      const instances: FigNode[] = [];
      for (const frame of state.frames) {
        collectInstancesIn(frame, instances);
      }
      const issues: string[] = [];
      for (const instance of instances) {
        const target = lookupInstanceTarget(state.source, state.registry, instance);
        if (!target) {
          // INSTANCE points at a SYMBOL outside the source, or has no
          // symbolID at all (Figma allows dangling instances). Skip.
          continue;
        }
        if (!state.fileByPath.has(target.filePath)) {
          issues.push(
            `INSTANCE "${instance.name}" → component "${target.componentName}" → no emitted TSX at ${target.filePath}`,
          );
        }
        if (target.variants.size > 0) {
          const variant = variantValueForInstance(state.source, state.registry, instance);
          if (variant !== undefined && !target.variants.has(variant)) {
            issues.push(
              `INSTANCE "${instance.name}" picks variant "${variant}" but component "${target.componentName}" has no such variant key`,
            );
          }
        }
      }
      expect(issues, issues.join("\n")).toEqual([]);
    });

    it("every TEXT node's resolved styleOverrideTable agrees with the document's style registry", () => {
      const state = requireState(stateRef);
      const issues = collectStyleResolutionIssues(state);
      expect(issues, issues.join("\n")).toEqual([]);
    });

    it("every emitted React identifier (frame and component) is a valid JavaScript identifier", () => {
      const state = requireState(stateRef);
      const ident = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
      const issues: string[] = [];
      for (const target of state.registry.frames.values()) {
        if (!ident.test(target.componentName)) {
          issues.push(`frame target produced invalid identifier: "${target.componentName}" (frame "${target.node.name}")`);
        }
      }
      for (const target of state.registry.components.values()) {
        if (!ident.test(target.componentName)) {
          issues.push(`component target produced invalid identifier: "${target.componentName}" (node "${target.node.name}")`);
        }
      }
      expect(issues, issues.join("\n")).toEqual([]);
    });

    it("token ids are unique across every kind (no `--foo` collision between colour, typography, spacing, radius, shadow tables)", () => {
      const state = requireState(stateRef);
      const allIds: string[] = [
        ...state.tokens.colors.keys(),
        ...state.tokens.typography.keys(),
        ...state.tokens.spacing.keys(),
        ...state.tokens.radii.keys(),
        ...state.tokens.shadows.keys(),
      ];
      const collisions = findDuplicates(allIds, (id) => id);
      expect(collisions, `token id collisions across kinds: ${collisions.join(", ")}`).toEqual([]);
    });

    it("App.tsx and index.ts list every registered frame target exactly once", () => {
      const state = requireState(stateRef);
      const appFile = state.fileByPath.get("App.tsx");
      const indexFile = state.fileByPath.get("index.ts");
      expect(appFile).toBeDefined();
      expect(indexFile).toBeDefined();
      if (!appFile || !indexFile) {
        return;
      }
      const issues: string[] = [];
      for (const target of state.registry.frames.values()) {
        const importPattern = new RegExp(
          `import\\s*\\{\\s*${target.componentName}\\s*\\}\\s*from\\s*["'][^"']+["']`,
        );
        if (!importPattern.test(appFile.contents)) {
          issues.push(`App.tsx is missing an import of frame "${target.componentName}"`);
        }
        if (!appFile.contents.includes(`Component: ${target.componentName}`)) {
          issues.push(`App.tsx entries[] is missing { Component: ${target.componentName} }`);
        }
        const reexportPattern = new RegExp(
          `export\\s*\\{\\s*${target.componentName}\\s*\\}\\s*from\\s*["'][^"']+["']`,
        );
        if (!reexportPattern.test(indexFile.contents)) {
          issues.push(`index.ts is missing the re-export of frame "${target.componentName}"`);
        }
      }
      expect(issues, issues.join("\n")).toEqual([]);
    });

    it("re-running the emit pipeline produces byte-identical output for fig-to-web's own surface", async () => {
      const state = requireState(stateRef);
      // Re-emit from the *same* loaded source. Determinism of
      // emitFromFrames is what the orchestrator's docstring promises:
      // "regenerating the same fig produces byte-identical output".
      // Map iteration order, sort instability, embedded timestamps —
      // any of those would surface here as a diff in the second run.
      //
      // `figma/*.svg` and `figma/*.html` are excluded from this check.
      // Those files are produced by `@higma-document-renderers/fig`
      // (`renderFigToSvg`), whose internal clipPath id generator is
      // process-scoped: the *first* call in a process emits `clip-g0-…`,
      // the *second* `clip-g1-…`, even with identical inputs. That is
      // a renderer-package concern (their counter is not per-render).
      // fig-to-web only forwards the resulting string. The diff is
      // cosmetic — clip-path ids are internal references — and does
      // not affect what the SVG renders. Production callers run a
      // single emit per process and never observe this; the test
      // exclusion isolates fig-to-web's own emit surface from a
      // dependency's process-state quirk so a regression in OUR code
      // (e.g. an emergent Map iteration sensitivity in JSX, registry,
      // or token output) still surfaces here.
      const second = await emitFromFrames(state.source, state.frames, { debugAttrs: false });
      const isOwnSurface = (filePath: string): boolean => !filePath.startsWith("figma/");
      const firstOwn = state.emitResult.files.filter((f) => isOwnSurface(f.path));
      const secondOwn = second.files.filter((f) => isOwnSurface(f.path));
      expect(secondOwn.length).toBe(firstOwn.length);
      expect(second.assets.length).toBe(state.emitResult.assets.length);
      const firstByPath = new Map(firstOwn.map((f): [string, string] => [f.path, f.contents]));
      const issues: string[] = [];
      for (const file of secondOwn) {
        const previous = firstByPath.get(file.path);
        if (previous === undefined) {
          issues.push(`second run produced an extra file: ${file.path}`);
          continue;
        }
        if (previous !== file.contents) {
          issues.push(`second run produced different bytes for ${file.path}`);
        }
      }
      const secondPaths = new Set(secondOwn.map((f) => f.path));
      for (const filePath of firstByPath.keys()) {
        if (!secondPaths.has(filePath)) {
          issues.push(`second run is missing ${filePath}`);
        }
      }
      const firstAssets = new Map(state.emitResult.assets.map((a): [string, Uint8Array] => [a.path, a.bytes]));
      for (const asset of second.assets) {
        const previous = firstAssets.get(asset.path);
        if (!previous) {
          issues.push(`second run produced an extra asset: ${asset.path}`);
          continue;
        }
        if (previous.byteLength !== asset.bytes.byteLength) {
          issues.push(`second run produced different byte count for asset ${asset.path}`);
        }
      }
      expect(issues, issues.join("\n")).toEqual([]);
    }, 240_000);
  });
}

function checkTsxBoilerplate(
  fileByPath: ReadonlyMap<string, EmitFile>,
  filePath: string,
  componentName: string,
): readonly string[] {
  const file = fileByPath.get(filePath);
  if (!file) {
    return [`expected emitted TSX at ${filePath}`];
  }
  const issues: string[] = [];
  if (!file.contents.startsWith("/**")) {
    issues.push(`${filePath} does not start with a JSDoc /** ... */ header`);
  }
  if (!file.contents.includes(`import * as React from "react";`)) {
    issues.push(`${filePath} is missing the React namespace import`);
  }
  const fnPattern = new RegExp(`export function ${componentName}\\b`);
  if (!fnPattern.test(file.contents)) {
    issues.push(`${filePath} is missing \`export function ${componentName}\``);
  }
  if (!file.contents.includes(`export default ${componentName};`)) {
    issues.push(`${filePath} is missing \`export default ${componentName};\``);
  }
  return issues;
}

// =============================================================================
// Style-id resolution check
// =============================================================================

type FillPaintBearer = {
  readonly fillPaints?: readonly unknown[];
  readonly styleIdForFill?: { readonly guid?: { readonly sessionID: number; readonly localID: number } };
};

type TextDataLike = {
  readonly styleOverrideTable?: readonly FillPaintBearer[];
};

function styleKeyOf(ref: { readonly guid?: { readonly sessionID: number; readonly localID: number } } | undefined): string | undefined {
  const guid = ref?.guid;
  if (!guid) {
    return undefined;
  }
  return `${guid.sessionID}:${guid.localID}`;
}

function collectStyleResolutionIssues(state: PipelineResult): readonly string[] {
  const issues: string[] = [];
  const allNodes: FigNode[] = [];
  for (const root of state.source.tree.roots) {
    collectAllDescendants(root, allNodes);
  }
  for (const node of allNodes) {
    if (getNodeType(node) !== "TEXT") {
      continue;
    }
    const direct = (node as { readonly styleOverrideTable?: readonly FillPaintBearer[] }).styleOverrideTable;
    const viaTextData = (node as { readonly textData?: TextDataLike }).textData?.styleOverrideTable;
    const sot = viaTextData ?? direct;
    if (!sot) {
      continue;
    }
    for (const entry of sot) {
      const key = styleKeyOf(entry.styleIdForFill);
      if (!key) {
        continue;
      }
      const registryPaints = state.source.styleRegistry.paints.get(key);
      if (!registryPaints) {
        continue;
      }
      // Resolution applied at load means the entry's fillPaints field
      // points at (or matches structurally) the registry's paints.
      // Identity is the strongest signal — load.ts passes the registry
      // value through `resolveStyledPaint`.
      if (entry.fillPaints !== registryPaints) {
        issues.push(
          `TEXT "${node.name ?? "(unnamed)"}" styleOverrideTable entry styleIdForFill=${key} retains stale fillPaints (registry has ${registryPaints.length} paints; entry has ${entry.fillPaints?.length ?? 0})`,
        );
      }
    }
  }
  return issues;
}
