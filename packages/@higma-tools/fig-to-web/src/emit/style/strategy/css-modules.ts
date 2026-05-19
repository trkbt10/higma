/**
 * @file CSS-Modules emit strategy.
 *
 * Walks an already-built JSX tree (produced by `emit/render/jsx.ts`),
 * extracts every inline `style={{ … }}` prop into a CSS rule indexed
 * by class name, and rewrites the prop into
 * `className={classes.<name>}`. The collected rules become a sidecar
 * `<ComponentName>.module.css` file emitted next to the TSX.
 *
 * Why a post-pass rather than threading the strategy through every
 * routine that builds JSX: the JsxNode tree is the single point where
 * "the element will receive this style record" is finalised. A walker
 * here keeps the css-modules logic localised; the rest of the emit
 * pipeline keeps emitting inline styles as before. The cost is one
 * extra pass over the tree per file — negligible against the
 * underlying font / image decode work.
 *
 * Dedup: identical style records collapse to the same class. The
 * canonical key is a sorted `key:value;`-joined string so insertion
 * order doesn't affect equality. The counter-based class names
 * (`c1`, `c2`, …) keep generated CSS deterministic across runs.
 *
 * What this strategy does NOT do (yet — those land in follow-up tasks):
 *   - Variant-aware attribute selectors (`.root[data-variant="On"]`).
 *     Today every variant case produces its own per-element classes;
 *     the user's preference for `[aria-*]` / `[data-*]` selectors is a
 *     larger refactor that requires merging variant subtrees into a
 *     single JSX template, which is task #9 in the project task list.
 *   - Splitting "static" (display, padding, color) from "dynamic"
 *     (left, top, width, height, transform) styles. Today every style
 *     property lands in the CSS module; the result is still correct
 *     (and benefits from scoping + static-asset delivery) but does
 *     not save bytes for unique-position descendants.
 */
import type { JsxNode, JsxProp, JsxStyleEntry } from "../../../lib/jsx-tree/types";
import { el, exprProp } from "../../../lib/jsx-tree/builder";
import type { EmitFile } from "../../types";

/**
 * One CSS rule the collector will write to the module file. The
 * `entries` are kept as the original JsxStyleEntry list so the CSS
 * emitter can re-use the same camelCase → kebab-case conversion
 * (and CSS custom-property pass-through) the inline serializer uses.
 */
type CssRule = {
  readonly className: string;
  readonly entries: readonly JsxStyleEntry[];
};

export type CssModulesCollector = {
  /**
   * Register a style record. Returns the class name the JSX should
   * carry; identical records (same canonical key) share a class.
   */
  readonly register: (entries: readonly JsxStyleEntry[]) => string;
  /**
   * Snapshot the rules registered so far. Used by tests; production
   * callers prefer `renderModule`.
   */
  readonly rules: () => readonly CssRule[];
  /** Render the `.module.css` file body. */
  readonly renderModule: () => string;
};

/** Build a fresh collector. State is scoped to one TSX file. */
export function createCssModulesCollector(): CssModulesCollector {
  const byKey = new Map<string, string>();
  const rules: CssRule[] = [];
  const refState = { counter: 0 };
  return {
    register: (entries) => {
      const key = canonicalKey(entries);
      const existing = byKey.get(key);
      if (existing !== undefined) {
        return existing;
      }
      refState.counter = refState.counter + 1;
      const className = `c${refState.counter}`;
      byKey.set(key, className);
      rules.push({ className, entries });
      return className;
    },
    rules: () => rules,
    renderModule: () => rules.map(renderRule).join("\n\n") + (rules.length > 0 ? "\n" : ""),
  };
}

function canonicalKey(entries: readonly JsxStyleEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.key.localeCompare(b.key));
  return sorted.map(({ key, value }) => `${key}:${value};`).join("");
}

function renderRule(rule: CssRule): string {
  const lines = [`.${rule.className} {`];
  for (const entry of rule.entries) {
    lines.push(`  ${cssPropertyName(entry.key)}: ${entry.value};`);
  }
  lines.push("}");
  return lines.join("\n");
}

/**
 * Convert a JsxStyleEntry key (camelCase, or a CSS custom property
 * `--name`) to its CSS form.
 *
 * `WebkitBackdropFilter` → `-webkit-backdrop-filter`: a leading
 * uppercase letter is rendered as `-<lowercase>` so vendor prefixes
 * survive the round-trip the React inline-style serializer goes
 * through. Standard camelCase keys (`backgroundImage`) become their
 * kebab-case equivalent (`background-image`).
 *
 * CSS custom properties (`--token-name`) pass through verbatim — they
 * are stored as JsxStyleEntry with a literal `--` prefix and are
 * already valid CSS identifiers.
 */
export function cssPropertyName(key: string): string {
  if (key.startsWith("--")) {
    return key;
  }
  // Every uppercase letter (including the leading one for vendor
  // prefixes like `WebkitBackdropFilter`) emits as `-<lowercase>`.
  // The branching version that distinguished leading vs interior
  // matches produced the same output and was dead structure; the
  // single replacement form makes that explicit.
  return key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

/**
 * Walk a JsxNode tree, replacing every `style={{ … }}` prop with a
 * `className={classes.<name>}` prop registered with `collector`.
 *
 * Existing `className` props are preserved when present — that case
 * does not occur in today's emit (the only `className` source was the
 * removed `fig-page` reset) but the merger keeps the function honest
 * if a future emit path emits both.
 *
 * Other prop kinds (data-*, aria-*, expression props for variant
 * assignments, spreads) pass through untouched.
 */
export function rewriteForCssModules(
  node: JsxNode,
  collector: CssModulesCollector,
): JsxNode {
  switch (node.kind) {
    case "text":
    case "expr":
      return node;
    case "fragment":
      return { kind: "fragment", children: node.children.map((c) => rewriteForCssModules(c, collector)) };
    case "element": {
      const rewrittenProps = rewriteProps(node.props, collector);
      const rewrittenChildren = node.children.map((c) => rewriteForCssModules(c, collector));
      return el(node.tag, { props: rewrittenProps, children: rewrittenChildren, layout: node.layout });
    }
  }
}

function rewriteProps(props: readonly JsxProp[], collector: CssModulesCollector): readonly JsxProp[] {
  const out: JsxProp[] = [];
  for (const prop of props) {
    if (prop.kind !== "style") {
      out.push(prop);
      continue;
    }
    if (prop.entries.length === 0) {
      continue;
    }
    const className = collector.register(prop.entries);
    out.push(exprProp("className", `classes.${className}`));
  }
  return out;
}

/**
 * Build the EmitFile for the sidecar `.module.css` matching a TSX
 * file. The path is the TSX path with the extension swapped for
 * `.module.css`. Returns undefined when the collector recorded no
 * rules (no styles → no sidecar needed).
 */
export function buildCssModuleFile(
  tsxFilePath: string,
  collector: CssModulesCollector,
): EmitFile | undefined {
  if (collector.rules().length === 0) {
    return undefined;
  }
  return { path: cssModulePathFor(tsxFilePath), contents: collector.renderModule() };
}

/** Relative path of the sidecar CSS module for a TSX file. */
export function cssModulePathFor(tsxFilePath: string): string {
  return tsxFilePath.replace(/\.tsx$/, ".module.css");
}

/**
 * Build the `import classes from "./X.module.css"` statement source
 * line. The import specifier is a same-directory relative path
 * because the sidecar is always emitted next to the TSX file.
 */
export function cssModuleImportLine(tsxFilePath: string): string {
  const slash = tsxFilePath.lastIndexOf("/");
  const baseName = slash >= 0 ? tsxFilePath.slice(slash + 1) : tsxFilePath;
  const moduleBase = baseName.replace(/\.tsx$/, ".module.css");
  return `import classes from "./${moduleBase}";`;
}
