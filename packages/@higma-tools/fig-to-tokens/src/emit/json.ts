/**
 * @file DTCG (Design Tokens Community Group) JSON emitter.
 *
 * Output shape per token:
 *
 *   {
 *     "$type": "color",
 *     "$value": "#0066ff",
 *     "$extensions": {
 *       "higma": {
 *         "source": "variable",
 *         "variableSet": "Colors",
 *         "defaultMode": "Light",
 *         "cssId": "colors-primary"
 *       },
 *       "modes": {
 *         "Light": "#0066ff",
 *         "Dark": "#3399ff"
 *       }
 *     }
 *   }
 *
 * `$extensions.modes` is non-standard (the DTCG mode spec is still in
 * flight) but it is the de-facto extension Tokens Studio and similar
 * tooling already read. `$extensions.higma` records the source-of-
 * truth metadata so a downstream pipeline can pivot off Figma's own
 * notion of a "Variable Set" without re-deriving it from the JSON
 * path.
 *
 * Nesting follows the slash-separated `Token.path`: `"Colors/Brand/Primary"`
 * becomes a `{ Colors: { Brand: { Primary: {...} } } }` tree. Leaf
 * keys are the last path segment, with one collision-safe quirk:
 * if a folder and a leaf share a name (rare but possible in Figma),
 * the leaf wins and the folder is dropped — fig-to-tokens issues a
 * warning via `console.warn` so the conflict is surfaced.
 */

import type {
  Token,
  TokenSet,
  TokenValue,
  TypographyValue,
} from "../token-set";

type DtcgValue = string | number | boolean | DtcgObject | readonly DtcgValue[];
type DtcgObject = { readonly [key: string]: DtcgValue };

type DtcgLeaf = {
  readonly $type?: string;
  readonly $value: DtcgValue;
  readonly $extensions?: DtcgObject;
};

type DtcgTree = { [key: string]: DtcgTree | DtcgLeaf };

export type TokensToJsonOptions = {
  /** Pretty-print indent. Default 2. */
  readonly indent?: number;
};

/** Serialize `tokens` to a DTCG JSON string. */
export function tokensToJson(tokens: TokenSet, options: TokensToJsonOptions = {}): string {
  const tree: DtcgTree = {};
  for (const token of tokens.tokens) {
    insertToken(tree, token);
  }
  const indent = options.indent ?? 2;
  return `${JSON.stringify(tree, null, indent)}\n`;
}

function insertToken(tree: DtcgTree, token: Token): void {
  const segments = token.path.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    return;
  }
  const folders = segments.slice(0, -1);
  const leafName = segments[segments.length - 1]!;
  const cursor = navigateToLeafFolder(tree, folders);
  const leaf = buildLeaf(token);
  const existing = cursor[leafName];
  if (existing && !isDtcgLeaf(existing)) {
    // Folder already occupies the slot — push the leaf under a
    // sentinel key so we don't drop it.
    (existing as DtcgTree)["$self"] = leaf;
    return;
  }
  cursor[leafName] = leaf;
}

/**
 * Walk `tree` along `folders`, creating empty subtrees for missing
 * segments and routing around already-claimed leaf slots so neither
 * a previously-inserted leaf nor the new folder is silently dropped.
 */
function navigateToLeafFolder(tree: DtcgTree, folders: readonly string[]): DtcgTree {
  return folders.reduce<DtcgTree>((cursor, folder) => {
    const existing = cursor[folder];
    if (existing === undefined) {
      const next: DtcgTree = {};
      cursor[folder] = next;
      return next;
    }
    if (isDtcgLeaf(existing)) {
      const fallback: DtcgTree = {};
      cursor[`${folder} (group)`] = fallback;
      return fallback;
    }
    return existing;
  }, tree);
}

function buildLeaf(token: Token): DtcgLeaf {
  const defaultValue = token.valuesByMode.get(token.defaultModeName)
    ?? token.valuesByMode.values().next().value;
  if (defaultValue === undefined) {
    throw new Error(`fig-to-tokens: token ${token.path} has no values`);
  }
  const $type = inferDtcgType(defaultValue);
  return {
    $type,
    $value: renderDtcgValue(defaultValue),
    $extensions: buildExtensions(token),
  };
}

function buildExtensions(token: Token): DtcgObject {
  const higma: { [key: string]: DtcgValue } = {
    source: token.source,
    cssId: token.cssId,
    defaultMode: token.defaultModeName,
  };
  if (token.variableSetName !== null) {
    higma.variableSet = token.variableSetName;
  }
  if (token.variableSetSlug !== null) {
    higma.variableSetSlug = token.variableSetSlug;
  }
  const extensions: { [key: string]: DtcgValue } = { higma };
  if (token.valuesByMode.size > 1) {
    const modes: { [key: string]: DtcgValue } = {};
    for (const [name, value] of token.valuesByMode) {
      modes[name] = renderDtcgValue(value);
    }
    extensions.modes = modes;
  }
  return extensions;
}

function inferDtcgType(value: TokenValue): string {
  switch (value.kind) {
    case "color":
      return "color";
    case "number":
      // Per DTCG, dimensions are typed `"dimension"` when carrying a
      // unit. A unit-less number stays `"number"`.
      return value.unit ? "dimension" : "number";
    case "boolean":
      return "boolean";
    case "string":
      return "string";
    case "typography":
      return "typography";
    case "shadow":
      return "shadow";
    case "raw-css":
      return "string";
  }
}

function renderDtcgValue(value: TokenValue): DtcgValue {
  switch (value.kind) {
    case "color":
      return value.css;
    case "number":
      return value.unit ? `${value.value}${value.unit}` : value.value;
    case "boolean":
      return value.value;
    case "string":
      return value.value;
    case "typography":
      return renderTypographyValue(value);
    case "shadow":
      return value.css;
    case "raw-css":
      return value.css;
  }
}

function renderTypographyValue(value: TypographyValue): DtcgObject {
  const out: { [key: string]: DtcgValue } = {
    fontFamily: value.fontFamily,
    fontSize: value.fontSize,
  };
  if (value.fontWeight !== undefined) {
    out.fontWeight = value.fontWeight;
  }
  if (value.lineHeight !== undefined) {
    out.lineHeight = value.lineHeight;
  }
  if (value.letterSpacing !== undefined) {
    out.letterSpacing = value.letterSpacing;
  }
  return out;
}

function isDtcgLeaf(value: DtcgTree | DtcgLeaf): value is DtcgLeaf {
  return Object.prototype.hasOwnProperty.call(value, "$value");
}
