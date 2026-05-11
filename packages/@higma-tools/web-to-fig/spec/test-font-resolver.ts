/**
 * @file Test-only font resolver.
 *
 * Production code paths (CLI, fullpage measure-bin, …) wire in a
 * platform-appropriate FontResolver (darwin `system_profiler`,
 * browser `document.fonts`). The spec suite needs *some* resolver to
 * exercise `normalizeViewport` without booting an OS-font enumerator
 * inside every test, and what each case actually cares about is one
 * of two contracts:
 *
 *   1. "the resolver was invoked, and its result lands in the IR" —
 *      satisfied by `staticFontResolver("Test Sans")`,
 *   2. "the resolver received the captured stack verbatim and got to
 *      choose" — satisfied by `recordingFontResolver(...)`, which
 *      stores every call so the spec can assert on the candidates.
 *
 * Co-located under `spec/` so production never imports it: this is a
 * test fixture, not a production fallback. Per AGENTS.md the
 * production code refuses to fabricate a default resolver — the only
 * way to invoke `normalizeViewport` is to hand one of these (or a
 * real implementation) over the boundary.
 */
import type { FontResolver, FontStackCandidate } from "../src/normalize/font-resolver";

/**
 * Returns a resolver that ignores the stack and always returns the
 * given family name. The exported default — `"Test Sans"` — is a
 * deliberately unrealistic name so a spec that accidentally relies
 * on a real OS font surfaces the violation as an unexpected value.
 */
export function staticFontResolver(family: string = "Test Sans"): FontResolver {
  return {
    resolve: () => family,
  };
}

/**
 * Returns a resolver plus the list of stacks it was called with.
 * Use when the spec asserts not only on the IR but on which CSS
 * stacks reached the resolver layer at all (e.g. "the inline `<a>`'s
 * own font-family was forwarded, not inherited silently").
 */
export type RecordingFontResolver = {
  readonly resolver: FontResolver;
  readonly calls: ReadonlyArray<readonly FontStackCandidate[]>;
};

/**
 * Build a FontResolver that records every stack it was called with.
 * Spec cases use this when they need to assert which CSS values
 * reached the resolver layer — e.g. confirming both a paragraph's
 * host stack and its inline-anchor stack are forwarded, not just
 * one of them.
 */
export function recordingFontResolver(family: string = "Test Sans"): RecordingFontResolver {
  const calls: (readonly FontStackCandidate[])[] = [];
  const resolver: FontResolver = {
    resolve(stack) {
      calls.push(stack);
      return family;
    },
  };
  return { resolver, calls };
}
