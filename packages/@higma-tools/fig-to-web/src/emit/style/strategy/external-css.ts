/**
 * @file External-stylesheet (BEM) emit strategy.
 *
 * `cssMode: "external-css"` emits ONE global stylesheet next to the
 * generated TSX (`styles.css`). Every TSX file may import it with
 * `import "./styles.css"` (when `cssImport: "direct"`) or rely on the
 * consumer to wire it up (`cssImport: "external"`).
 *
 * Class names follow BEM (`<block>__c<n>` today; `<block>__c<n>--<mod>`
 * once variant-aware emission lands in task #9):
 *
 *   - `<block>` is the component slug derived from the Figma frame /
 *     symbol name. It scopes every class to its source component so
 *     two components can carry the same generated counter without
 *     colliding when their rules land in a single stylesheet.
 *   - `c<n>` is a deterministic counter assigned in the order the
 *     rewriter walks the JSX tree. Identical style records inside
 *     the SAME component share a class (per-component dedup); two
 *     components with the same style get distinct classes (cheap to
 *     reason about, no cross-component coupling).
 *
 * Class-on-JSX form: `className="<bem>"` (a literal string prop) so
 * the consumer's JSX renders without any CSS-Modules build-step.
 *
 * The strategy shares plumbing with the css-modules collector:
 * canonical key + counter-based dedup, camelCase → kebab-case
 * conversion (delegated to `cssPropertyName`), and the same JsxNode
 * rewriter shape. What differs is (a) class-name generation, (b) the
 * resulting prop kind (string vs expression), and (c) collection
 * scope (global across components vs per-file).
 */
import type { JsxNode, JsxProp, JsxStyleEntry } from "../../../lib/jsx-tree/types";
import { el, strProp } from "../../../lib/jsx-tree/builder";
import type { EmitFile } from "../../types";
import { cssPropertyName } from "./css-modules";

type CssRule = {
  readonly className: string;
  readonly entries: readonly JsxStyleEntry[];
};

export type ExternalCssCollector = {
  /**
   * Register a style record under the bound block. Returns the BEM
   * class string the JSX should carry. Identical records inside the
   * same block collapse onto the same class.
   */
  readonly register: (entries: readonly JsxStyleEntry[]) => string;
  /** Snapshot the rules collected so far. */
  readonly rules: () => readonly CssRule[];
};

export type ExternalCssRegistry = {
  /** Open a per-block collector that contributes rules to the registry. */
  readonly forBlock: (block: string) => ExternalCssCollector;
  /** Snapshot every rule from every block in registration order. */
  readonly allRules: () => readonly CssRule[];
  /** Build the single sidecar stylesheet, or undefined when empty. */
  readonly renderStylesheet: (path: string) => EmitFile | undefined;
};

/**
 * Build a registry shared by every component / page emit in one run.
 *
 * The registry owns block-level dedup state. Each block produces its
 * own collector via `forBlock`; rules emitted through those
 * collectors flow into the registry's global list in the order the
 * walker traverses them.
 */
export function createExternalCssRegistry(): ExternalCssRegistry {
  const allRules: CssRule[] = [];
  const blockStates = new Map<string, { counter: number; byKey: Map<string, string> }>();
  return {
    forBlock: (block) => {
      const state = ensureBlockState(blockStates, block);
      return {
        register: (entries) => {
          const key = canonicalKey(entries);
          const existing = state.byKey.get(key);
          if (existing !== undefined) {
            return existing;
          }
          state.counter = state.counter + 1;
          const className = `${block}__c${state.counter}`;
          state.byKey.set(key, className);
          allRules.push({ className, entries });
          return className;
        },
        rules: () => allRules.filter((r) => r.className.startsWith(`${block}__`)),
      };
    },
    allRules: () => allRules,
    renderStylesheet: (path) => {
      if (allRules.length === 0) {
        return undefined;
      }
      const contents = allRules.map(renderRule).join("\n\n") + "\n";
      return { path, contents };
    },
  };
}

function ensureBlockState(
  store: Map<string, { counter: number; byKey: Map<string, string> }>,
  block: string,
): { counter: number; byKey: Map<string, string> } {
  const existing = store.get(block);
  if (existing) {
    return existing;
  }
  const fresh = { counter: 0, byKey: new Map<string, string>() };
  store.set(block, fresh);
  return fresh;
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
 * Convert a free-form name (Figma layer name, component name) into a
 * BEM-safe block slug. Lowercase, hyphen-separated, alphanumeric.
 *
 * The slug is stable and visually identifiable in the produced
 * stylesheet, which is the point of using BEM over scoped modules —
 * a developer reading `styles.css` can trace a rule back to a
 * specific component without indirection.
 *
 * Empty / non-alphanumeric-only names throw. The slug becomes part
 * of every CSS rule in the produced stylesheet; a silent fallback
 * (e.g. `"component"`) would cause every nameless block to collide
 * on the same class prefix and overwrite each other's rules. Per
 * the fail-fast policy the registry surfaces the problem at its
 * source rather than rescuing it here.
 */
export function blockSlugFromName(name: string): string {
  const slug = name
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  if (slug.length === 0) {
    throw new Error(
      `external-css: cannot derive a block slug from name "${name}". ` +
      `The slug seeds every class name for this component; an empty input ` +
      `would collide every nameless component on the same prefix.`,
    );
  }
  return slug;
}

/**
 * Walk a JsxNode tree, replacing every `style={{ … }}` prop with a
 * `className="<bem>"` literal prop registered with `collector`.
 *
 * Mirrors the css-modules rewriter shape so callers can dispatch on
 * `cssMode` without branching their own JSX traversal. The only
 * difference is the resulting prop kind: a `string` JsxProp here,
 * versus an `expr` JsxProp pointing at `classes.<name>` in the
 * css-modules path.
 */
export function rewriteForExternalCss(
  node: JsxNode,
  collector: ExternalCssCollector,
): JsxNode {
  switch (node.kind) {
    case "text":
    case "expr":
      return node;
    case "fragment":
      return { kind: "fragment", children: node.children.map((c) => rewriteForExternalCss(c, collector)) };
    case "element": {
      const rewrittenProps = rewriteProps(node.props, collector);
      const rewrittenChildren = node.children.map((c) => rewriteForExternalCss(c, collector));
      return el(node.tag, { props: rewrittenProps, children: rewrittenChildren, layout: node.layout });
    }
  }
}

function rewriteProps(props: readonly JsxProp[], collector: ExternalCssCollector): readonly JsxProp[] {
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
    out.push(strProp("className", className));
  }
  return out;
}

/**
 * Build the `import "./styles.css"` side-effect import line that
 * each TSX file emits when `cssImport: "direct"`. Returns an empty
 * string for `cssImport: "external"` (consumer wires it up).
 */
export function externalStylesheetImport(
  tsxFilePath: string,
  stylesheetPath: string,
  cssImport: "direct" | "external",
): string {
  if (cssImport !== "direct") {
    return "";
  }
  const specifier = relativeStylesheetSpecifier(tsxFilePath, stylesheetPath);
  return `import ${JSON.stringify(specifier)};`;
}

/**
 * Compute the `./...` relative specifier from a TSX file's directory
 * to the global stylesheet path. Mirrors the same path-shape contract
 * the JSX emitter's `relativeImportPath` honours: the result always
 * starts with `./` or `../` so TypeScript treats it as a module
 * specifier, never an ambient one.
 */
export function relativeStylesheetSpecifier(fromTsxPath: string, toCssPath: string): string {
  const fromParts = fromTsxPath.split("/").slice(0, -1);
  const toParts = toCssPath.split("/");
  const sharedCount = countSharedPrefix(fromParts, toParts.slice(0, -1));
  const ascend = fromParts.length - sharedCount;
  const remaining = toParts.slice(sharedCount).join("/");
  const prefix = ascend === 0 ? "./" : "../".repeat(ascend);
  return `${prefix}${remaining}`;
}

function countSharedPrefix(a: readonly string[], b: readonly string[]): number {
  const max = Math.min(a.length, b.length);
  for (let i = 0; i < max; i = i + 1) {
    if (a[i] !== b[i]) {
      return i;
    }
  }
  return max;
}
