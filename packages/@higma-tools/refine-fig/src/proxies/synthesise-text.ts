/**
 * @file Synthesise a new TEXT-style proxy on the Internal Only Canvas.
 *
 * Strategy mirrors `synthesise-fill.ts`: clone an existing TEXT-style
 * proxy and patch in the agent-authored name plus the desired
 * (font, size, line-height, letter-spacing). The borrowed fields
 * carry the `derivedTextData` (glyph outlines) of the template's
 * sample characters; we keep them as-is so the proxy renders to a
 * valid sample swatch in Figma.
 *
 * If the template's font face differs from the proxy's authored
 * descriptor, Figma re-derives the data on next open — we are not
 * obligated to produce the perfect derived data now, only a
 * structurally-valid proxy.
 *
 * Limitation: this function requires at least one TEXT-style proxy
 * already to exist in the file. Files that have no TEXT styles at
 * all (the YouTube fixture is one) cannot grow new TEXT proxies
 * here, because there is no `derivedTextData` shape to copy.
 * Callers should detect this and either skip text-proxy creation
 * for those files or import a template proxy first.
 */
import type { FigFontName, FigKiwiTextData, FigNode, FigValueWithUnits } from "@higma-document-models/fig/types";
import type { LoadedFigFile } from "@higma-document-models/fig/domain";
import type { GuidAllocator } from "@higma-document-io/fig/roundtrip";
import { addNodeChange } from "@higma-document-io/fig/roundtrip";

export type TextProxyDescriptor = {
  readonly fontName: FigFontName;
  readonly fontSize: number;
  readonly lineHeight?: FigValueWithUnits;
  readonly letterSpacing?: FigValueWithUnits;
};

export type SynthesiseTextProxyArgs = {
  readonly loaded: LoadedFigFile;
  readonly internalCanvasGuid: string;
  /** GUID of an existing TEXT-style proxy whose shape we'll clone. */
  readonly templateProxyGuid: string;
  readonly allocator: GuidAllocator;
  readonly name: string;
  readonly descriptor: TextProxyDescriptor;
};

/** Insert a new TEXT-style proxy by cloning an existing template proxy. */
export function synthesiseTextProxy(args: SynthesiseTextProxyArgs): { readonly guid: string; readonly node: FigNode } {
  const { loaded, internalCanvasGuid, templateProxyGuid, allocator, name, descriptor } = args;
  const template = findByGuid(loaded, templateProxyGuid);
  if (!template) {
    throw new Error(`synthesiseTextProxy: template proxy ${templateProxyGuid} not found in loaded file`);
  }
  if (template.styleType?.name !== "TEXT") {
    throw new Error(`synthesiseTextProxy: template ${templateProxyGuid} is not a TEXT-style proxy`);
  }
  const newGuid = allocator.next();
  const internalGuid = parseGuidString(internalCanvasGuid);

  const newNode: FigNode = {
    ...template,
    guid: newGuid,
    name,
    parentIndex: rebaseParent(template, internalGuid),
    fontName: descriptor.fontName,
    fontSize: descriptor.fontSize,
    lineHeight: descriptor.lineHeight ?? template.lineHeight,
    letterSpacing: descriptor.letterSpacing ?? template.letterSpacing,
    textData: cloneTextDataWithFont(template.textData, descriptor),
  };
  addNodeChange(loaded, newNode);
  return { guid: `${newGuid.sessionID}:${newGuid.localID}`, node: newNode };
}

function cloneTextDataWithFont(
  td: FigKiwiTextData | undefined,
  descriptor: TextProxyDescriptor,
): FigKiwiTextData | undefined {
  if (!td) {
    return undefined;
  }
  // Keep derivedTextData verbatim — Figma re-derives on next open
  // when the font changes; until then the existing glyph outlines
  // stand in for a structurally-valid proxy. We only update what
  // is honest to update: the descriptor metadata in textData.
  void descriptor;
  return { ...td };
}

function rebaseParent(
  template: FigNode,
  newParentGuid: { sessionID: number; localID: number },
): { guid: { sessionID: number; localID: number }; position: string } {
  if (template.parentIndex) {
    return { ...template.parentIndex, guid: newParentGuid };
  }
  return { guid: newParentGuid, position: "z" };
}

function findByGuid(loaded: LoadedFigFile, guidString: string): FigNode | undefined {
  return loaded.nodeChanges.find((n) => {
    const g = n.guid;
    if (!g) {
      return false;
    }
    return `${g.sessionID}:${g.localID}` === guidString;
  });
}

function parseGuidString(s: string): { sessionID: number; localID: number } {
  const [a, b] = s.split(":");
  if (a === undefined || b === undefined) {
    throw new Error(`synthesiseTextProxy: bad guid string "${s}"`);
  }
  const sessionID = Number.parseInt(a, 10);
  const localID = Number.parseInt(b, 10);
  if (!Number.isFinite(sessionID) || !Number.isFinite(localID)) {
    throw new Error(`synthesiseTextProxy: non-numeric guid "${s}"`);
  }
  return { sessionID, localID };
}
