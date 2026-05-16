/**
 * @file Public entry — programmatic API for fig-to-svelte.
 *
 * The emit pipeline is not yet implemented. The package stands up the
 * directory layout, CLI stub, and dependency graph so that the
 * Svelte-flavoured emitter can land next to fig-to-web / fig-to-vue
 * without further structural churn. See task #8 in the project task
 * list for the implementation milestone.
 *
 * When the emit pipeline arrives, it should mirror fig-to-web's
 * shape: a `loadFigSource`-equivalent stage, design-token extraction,
 * a JsxNode-equivalent tree for Svelte templates, and the same set
 * of CSS-strategy options (inline / css-modules / external-css /
 * tailwind) plumbed via `EmitFromFramesOptions`. The shared
 * complexity scorer lives at `@higma-document-renderers/fig/asset-plan`
 * so the icon-externalisation decision logic can be reused.
 */
export const SCAFFOLD_NOTE =
  "fig-to-svelte is a scaffolded package; the Svelte emit pipeline is not yet implemented. " +
  "Track the milestone in the project task list (task #8).";
