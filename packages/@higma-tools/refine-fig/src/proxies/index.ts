/**
 * @file Public entry — proxy synthesisers.
 *
 * Two strategies live here. `synthesiseFillProxy` /
 * `synthesiseTextProxy` clone an existing template proxy already in
 * the file, which is the cheap path when the file is published with
 * shared styles. `bootstrapFillProxy` / `bootstrapTextProxy` build a
 * proxy from scratch — the agent uses these on files that have no
 * proxies of that kind to clone, so the apply layer can still emit a
 * `create-*-proxy` action and bind palette / typography decisions
 * against the result.
 */
export { synthesiseFillProxy } from "./synthesise-fill";
export type { SynthesiseFillProxyArgs } from "./synthesise-fill";
export { synthesiseTextProxy } from "./synthesise-text";
export type { SynthesiseTextProxyArgs, TextProxyDescriptor } from "./synthesise-text";
export { bootstrapFillProxy } from "./bootstrap-fill";
export type { BootstrapFillProxyArgs } from "./bootstrap-fill";
export { bootstrapTextProxy } from "./bootstrap-text";
export type { BootstrapTextProxyArgs } from "./bootstrap-text";
