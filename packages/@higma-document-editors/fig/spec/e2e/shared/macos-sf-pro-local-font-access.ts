/** @file macOS Local Font Access fixture for SF Pro and SF Pro Rounded. */

import { existsSync, readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

export const MACOS_SFNS_FONT_PATH = "/System/Library/Fonts/SFNS.ttf";
export const MACOS_SFNS_ROUNDED_FONT_PATH = "/System/Library/Fonts/SFNSRounded.ttf";

const MACOS_LOCAL_FONT_ACCESS_ORIGIN = "http://localhost:5192";

type MacOsSfProLocalFontPayload = {
  readonly systemFontBase64: string;
  readonly roundedFontBase64: string;
};

type BrowserLocalFontFixture = {
  readonly family: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly style: string;
  readonly base64: string;
};

/** Return whether this macOS host exposes the SF Pro font files used by real-font E2E. */
export function hasMacOsSfProLocalFontFiles(): boolean {
  return existsSync(MACOS_SFNS_FONT_PATH) && existsSync(MACOS_SFNS_ROUNDED_FONT_PATH);
}

/** Install a browser Local Font Access fixture backed by the host SF Pro font files. */
export async function installMacOsSfProLocalFontAccess(page: Page): Promise<void> {
  if (!hasMacOsSfProLocalFontFiles()) {
    throw new Error(
      `installMacOsSfProLocalFontAccess requires ${MACOS_SFNS_FONT_PATH} and ${MACOS_SFNS_ROUNDED_FONT_PATH}`,
    );
  }
  await page.context().grantPermissions(["local-fonts"], { origin: MACOS_LOCAL_FONT_ACCESS_ORIGIN });
  const payload: MacOsSfProLocalFontPayload = {
    systemFontBase64: readFileSync(MACOS_SFNS_FONT_PATH).toString("base64"),
    roundedFontBase64: readFileSync(MACOS_SFNS_ROUNDED_FONT_PATH).toString("base64"),
  };
  await page.addInitScript((fontPayload: MacOsSfProLocalFontPayload) => {
    Object.defineProperty(globalThis.navigator, "userAgent", {
      configurable: true,
      get(): string {
        return "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
      },
    });

    function base64ToBytes(value: string): Uint8Array {
      const binary = atob(value);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }

    function browserLocalFontFixtureToFontData(fixture: BrowserLocalFontFixture) {
      const bytes = base64ToBytes(fixture.base64);
      return {
        family: fixture.family,
        fullName: fixture.fullName,
        postscriptName: fixture.postscriptName,
        style: fixture.style,
        async blob(): Promise<Blob> {
          const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          return new Blob([buffer], { type: "font/ttf" });
        },
      };
    }

    const sfProLocalFontStyles = ["Regular", "Medium", "Semibold", "Bold"];
    const systemFontFixtures: BrowserLocalFontFixture[] = sfProLocalFontStyles.map((style) => ({
      family: "System Font",
      fullName: `System Font ${style}`,
      postscriptName: `.SFNS-${style}`,
      style,
      base64: fontPayload.systemFontBase64,
    }));
    const roundedFontFixtures: BrowserLocalFontFixture[] = sfProLocalFontStyles.map((style) => ({
      family: ".SF NS Rounded",
      fullName: `.SF NS Rounded ${style}`,
      postscriptName: `.SFNSRounded-${style}`,
      style,
      base64: fontPayload.roundedFontBase64,
    }));
    const fontData = [...systemFontFixtures, ...roundedFontFixtures].map(browserLocalFontFixtureToFontData);
    Object.defineProperty(globalThis, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: async () => fontData,
    });
  }, payload);
}
