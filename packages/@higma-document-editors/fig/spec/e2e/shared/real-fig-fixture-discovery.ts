import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const FIXTURE_DIR = resolve(__dirname, "../../../dev/public/fig-fixtures.tmp");

export type SourceBackedPair = {
  readonly primary: string;
  readonly source: string;
};

export function discoverSourceBackedPair(): SourceBackedPair | undefined {
  if (!existsSync(FIXTURE_DIR)) {
    return undefined;
  }
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".fig"));
  for (const file of files) {
    if (file.endsWith("-source.fig")) {
      continue;
    }
    const sourceName = file.replace(".fig", "-source.fig");
    if (files.includes(sourceName)) {
      return { primary: file, source: sourceName };
    }
  }
  return undefined;
}

export function discoverStandaloneFixtures(): readonly string[] {
  if (!existsSync(FIXTURE_DIR)) {
    return [];
  }
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".fig") && !f.endsWith("-source.fig"));
}

export function resolveFixture(name: string): string {
  return resolve(FIXTURE_DIR, name);
}

export function fixtureExists(name: string): boolean {
  return existsSync(resolveFixture(name));
}

export type ExportArtifactEnv = {
  readonly framedExportSvgPath?: string;
};

const EXPORT_ARTIFACT_ENV_PATH = resolve(__dirname, "real-fig-export-artifacts.json");

export function loadExportArtifactEnv(): ExportArtifactEnv {
  if (!existsSync(EXPORT_ARTIFACT_ENV_PATH)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(EXPORT_ARTIFACT_ENV_PATH, "utf8"));
  } catch {
    return {};
  }
}
