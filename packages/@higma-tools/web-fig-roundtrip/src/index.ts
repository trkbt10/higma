/**
 * @file Top-level exports for `@higma-tools/web-fig-roundtrip`.
 *
 * The package's role is to drive the full web → fig → fig-to-web →
 * browser-render verification loop. Both `@higma-tools/web-to-fig`
 * and `@higma-tools/fig-to-web` are same-scope siblings under the
 * boundary rules, so they cannot import each other directly. This
 * neutral package owns code that needs both — visual-fidelity
 * verification, end-to-end smoke tests, and round-trip scripts.
 */
export * from "./verify";
