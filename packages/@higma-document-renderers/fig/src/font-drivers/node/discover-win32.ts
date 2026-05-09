/**
 * @file Windows font discovery via the Fonts registry.
 *
 * On Windows the OS-canonical font catalogue is the registry, not the
 * `C:\Windows\Fonts` directory. Two keys list installed fonts:
 *
 *   HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts
 *     System-wide, mostly bare filenames resolved against
 *     `%WINDIR%\Fonts`.
 *
 *   HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts
 *     Per-user (Windows 10 1809+), values may be absolute paths
 *     pointing into `%LOCALAPPDATA%\Microsoft\Windows\Fonts`.
 *
 * We invoke `reg.exe query` with `/s` / `/t REG_SZ` to enumerate
 * each subkey. `reg.exe` is part of every Windows install since XP,
 * so requiring it does not introduce a new dependency.
 *
 * If `reg.exe` is unavailable (Wine without that binary, container
 * without the OS) we fall back to scanning the canonical Fonts
 * directories. The fallback is narrower than the registry view —
 * fonts whose registry entry points outside `%WINDIR%\Fonts` and
 * `%LOCALAPPDATA%\Microsoft\Windows\Fonts` are missed — but never
 * silently substituted.
 */

import * as path from "node:path";
import { classifyFontFile, scanFontDirectories } from "./discover-dirs";
import type {
  DiscoveredFontFile,
  DiscoveryEnv,
  DiscoveryResult,
} from "./discover-types";

const HKLM_FONTS_KEY = "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";
const HKCU_FONTS_KEY = "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";

/**
 * Enumerate the Windows font catalogue. Tries the Fonts registry
 * (`reg.exe query`) first; if `reg.exe` is unavailable, falls back
 * to scanning the canonical Fonts directories.
 */
export async function discoverWin32(env: DiscoveryEnv): Promise<DiscoveryResult> {
  const fromRegistry = await tryRegistry(env);
  if (fromRegistry) {
    return { files: fromRegistry, source: "win32-registry" };
  }
  return {
    files: scanFontDirectories(env.fs, fallbackDirs(env)),
    source: "win32-dirs",
  };
}

async function tryRegistry(
  env: DiscoveryEnv,
): Promise<readonly DiscoveredFontFile[] | undefined> {
  try {
    const [system, user] = await Promise.all([
      runRegQuery(env, HKLM_FONTS_KEY),
      runRegQuery(env, HKCU_FONTS_KEY).catch(() => ""),
    ]);
    const systemEntries = parseRegQueryOutput(system);
    const userEntries = parseRegQueryOutput(user);
    const fontsRoot = resolveWindowsFontsRoot(env);
    const seen = new Set<string>();
    const out: DiscoveredFontFile[] = [];
    for (const entry of [...systemEntries, ...userEntries]) {
      const resolved = resolveRegistryFontPath(entry.value, fontsRoot);
      if (!resolved) {
        continue;
      }
      if (classifyFontFile(resolved) !== "parseable") {
        continue;
      }
      if (seen.has(resolved)) {
        continue;
      }
      seen.add(resolved);
      out.push({ path: resolved });
    }
    return out;
  } catch (err) {
    void err;
    return undefined;
  }
}

async function runRegQuery(env: DiscoveryEnv, key: string): Promise<string> {
  return env.exec.run("reg.exe", ["query", key, "/s", "/t", "REG_SZ"]);
}

type RegEntry = {
  readonly name: string;
  readonly value: string;
};

/**
 * Parse `reg.exe query KEY /s /t REG_SZ` output. The format on every
 * supported Windows version is:
 *
 *   HKEY_LOCAL_MACHINE\...\Fonts
 *       Arial (TrueType)    REG_SZ    arial.ttf
 *       Arial Bold (TrueType)    REG_SZ    arialbd.ttf
 *
 *   HKEY_LOCAL_MACHINE\...\OtherKey
 *       ...
 *
 * Each value line starts with four leading spaces, has the value name,
 * `REG_SZ`, and the value separated by runs of whitespace.
 */
export function parseRegQueryOutput(stdout: string): readonly RegEntry[] {
  const out: RegEntry[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const match = /^\s{4,}(.+?)\s+REG_SZ\s+(.+)$/.exec(rawLine);
    if (!match) {
      continue;
    }
    const name = match[1].trim();
    const value = match[2].trim();
    if (name.length === 0 || value.length === 0) {
      continue;
    }
    out.push({ name, value });
  }
  return out;
}

/**
 * Bare filenames in the registry are resolved against
 * `%WINDIR%\Fonts`; absolute paths are taken verbatim. We don't try
 * to validate that the file exists — discovery stays cheap and the
 * indexer's `safelyReadFontInfos` filters dead entries.
 */
function resolveRegistryFontPath(value: string, fontsRoot: string): string | undefined {
  if (value.length === 0) {
    return undefined;
  }
  if (path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value)) {
    return value;
  }
  return path.join(fontsRoot, value);
}

function resolveWindowsFontsRoot(env: DiscoveryEnv): string {
  if (env.windowsDir && env.windowsDir.length > 0) {
    return path.join(env.windowsDir, "Fonts");
  }
  return "C:\\Windows\\Fonts";
}

function fallbackDirs(env: DiscoveryEnv): readonly string[] {
  const dirs: string[] = [resolveWindowsFontsRoot(env)];
  if (env.localAppData && env.localAppData.length > 0) {
    dirs.push(path.join(env.localAppData, "Microsoft\\Windows\\Fonts"));
  }
  return dirs;
}
