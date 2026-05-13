---
name: refine-fig
description: Refine a Figma `.fig` file using the `@higma-tools/refine-fig` toolchain. Discover repeated subtrees, palette colours, and typography clusters; have the agent author a `decisions.json` naming each one; then mutate the file to bind colours to existing or freshly-cloned style proxies and to componentize repeated icons (SYMBOL + INSTANCE). Use when the user asks to refine, tidy, rename, theme, componentize, or extract variants from a `.fig` file.
---

# refine-fig

Refine a `.fig` by driving the `@higma-tools/refine-fig` toolchain. The skill is the *protocol* for using the toolchain correctly: where to look, what to refuse, and how to confirm an apply did not silently break image or geometry content. Every apply mutation is the consequence of an explicit, agent-authored decision; nothing in the skill picks names heuristically.

## Why a protocol, not a script

The toolchain produces facts (inventory) and the agent produces choices (decisions). Combining the two is deterministic. The toolchain refuses to invent names, refuses to bind a paint stack that contains an IMAGE / GRADIENT layer, and refuses to componentize a cluster whose members are not structurally identical to the chosen exemplar. The agent's job is the judgement work: looking at contact-sheet PNGs, deciding what each cluster is, naming colours and text styles. The toolchain's job is to reify those decisions safely.

## Invariants

These are not negotiable.

1. **Names are agent-authored.** No heuristic ever fills `decisions.json`. An empty name means "do nothing for this entry"; silence is honest.
2. **Image / gradient fills are inviolable.** A fill-style binding only fires on a single-visible-SOLID paint stack with default blend. Multi-paint or IMAGE / GRADIENT stacks are excluded — `inventory.palette[].usages[].bindEligible` is the boundary.
3. **Componentize requires identity.** Cluster members get rewritten to INSTANCEs only when their subtree fingerprint matches the exemplar's exactly. The fingerprint folds in descendant types, sizes, geometry blob indices, paint stacks (SOLID colour quantised, IMAGE `imageRef`), TEXT content + font descriptor, nested INSTANCE `symbolID`, opacity, and corner-radius — every visually-significant axis. Visual-hash similarity is enough to *surface* the cluster, not enough to *promote* it.
4. **Visual review precedes apply.** Read the workbench PNGs before authoring decisions. Read the structural diff after applying.
5. **OS fonts only.** The renderer resolves text glyphs from the host OS. If a face is missing the affected subtrees show up in `inventory.unrenderable[]` and have no workbench PNGs — do not adopt decisions for them.
6. **Output is isolated.** All artifacts live under a directory the user (or you) chose for the task. Pick a path the repo's `.gitignore` already excludes (e.g. `.tmp-output/`).
7. **No identifying provenance.** Do not record source file names, brand names, or reference materials in artifacts or commits.

## Preflight requirements

Confirm these on the *input* file before authoring decisions.

- **Internal Only Canvas — auto-bootstrapped if missing.** When the file has no Internal Only Canvas and the plan calls for proxy creation, the plan layer prepends an `ensure-internal-canvas` action and apply inserts a fresh DOCUMENT-rooted `CANVAS { internalOnly: true }` before any `create-*-proxy` runs. `loadRefineSource.internalCanvas` is `undefined` in this case — that is no longer an error. The ensure action is suppressed when the plan has no proxies to create (silence stays honest when there is no work to do).

Proxy creation does not require a pre-existing template. When the file already carries at least one FILL or TEXT proxy, the apply step *clones* its shape (cheap and faithful to existing exports). When the file has none, the apply step *bootstraps* one from scratch — encoding a 100×100 commands blob and assembling the proxy fields by hand for FILL, or building a minimal `textData` and letting Figma re-derive `derivedTextData` on next open for TEXT. Either way the agent's palette / typography decisions land.

## Pre-decision health check

After running `inventory` and before authoring `decisions.json`, read the inventory and check:

- **`palette[].aliases.length`** — number of fine colour buckets the perceptual-merge pass absorbed into this entry. A large `aliases.length` on a single entry (say `aliases=8` for one `#000000`) is the expected fingerprint of an SVG-round-tripped design system: 1/255 channel drift produces 5–10 micro-buckets that visually collapse to one. The merge happens automatically; what the agent needs to do is *not name the aliases separately* — the alias keys are not present in `decisions.palette` at all, only the merged representative is. If two of your "distinct theme colours" surprise you by collapsing, raise the tolerance discussion with the user before naming; if the analyser refuses to load because two existing FILL proxies fall inside one merged group, the agent must pick which proxy to keep before retrying.
- **`typography[].aliases.length`** — near-duplicate descriptors (same family / style / weight / size; differing line-height or letter-spacing). The analyser surfaces these but does *not* merge them automatically — that is the agent's call. When `aliases[].differingFields` is `["lineHeightKey"]` (the most common case), the alias is almost certainly a stray that should be merged back. Use `decisions.typography[aliasKey] = { name: "", merge: primaryKey }` to redirect every bind action to the primary's proxy.
- **`palette[].existingProxyName`** — when set, the merged entry already has a published FILL proxy. Naming it still triggers a bind across every eligible usage; the plan layer reuses the existing GUID instead of synthesising a new proxy. Same for `typography[].existingProxyName`.
- **`unrenderable[]`** — top-level frames the cluster detector could not render (host OS missing a font). These get no workbench PNG and must not appear in `decisions.clusters`. Tell the user which font to install if naming depends on the text inside.
- **`subtreeClusters[]` v1 / v2 suffixes** — when a `clusterId` ends in `_v1` / `_v2` the role-signature pre-grouping split what is probably one logical cluster into siblings (e.g. variant cards). The strict-fingerprint check in `componentize` will keep them separate at promote time anyway; if you want them grouped, that is a variant-set decision (P2-1) rather than a single SYMBOL promotion.
- **`layoutHints[]`** — FRAMEs whose children form a uniform row or column. The analyser refuses ambiguous cases (mixed sizes, non-uniform gaps, invisible children, both axes passing) so every hint is high-confidence; the choice to adopt is still the agent's via `decisions.layouts[guid].apply = true`. A common pattern is multi-digit number labels (e.g. "10" as two side-by-side glyphs) — these show up as HORIZONTAL hints with childCount=2.

The merge / health-check fields are facts, not heuristics — the protocol's "names are agent-authored" invariant still holds. The analyser surfaces structure; the agent decides.

## Toolchain

Each command is invoked as `bun packages/@higma-tools/refine-fig/src/cli/bin.ts <command>`.

| Command | Reads | Writes |
|---|---|---|
| `inventory <fig> --out <dir> [--skip-clusters]` | `<fig>` | `<dir>/inventory.json` |
| `workbench <fig> --inventory <dir> --out <dir>` | `<fig>` + inventory | per-cluster / per-colour / per-typography PNGs + `index.json` |
| `scaffold --inventory <dir> --out <decisions.json>` | inventory | blank `decisions.json` whose keys mirror the inventory |
| `plan <fig> --inventory <dir> --decisions <decisions.json> --out <plan.json>` | both | typed plan |
| `apply <fig> --plan <plan.json> --out <out.fig>` | plan + fig | refined `.fig` |
| `verify <before.fig> <after.fig> --out <dir>` | both | per-frame `before.png` / `after.png` / `diff.png` |
| `diff <before.fig> <after.fig> [--out <report.json>]` | both | structural-difference report |

`verify` and `diff` are complementary. `verify` rasterises both files and pixel-diffs frames; `diff` walks `nodeChanges` and reports what actually changed in the file (missing nodes, parent moves, type flips, image-fill loss, blob rewires). When the two disagree, **`diff` is authoritative for fidelity questions** — pixel diffs include rasteriser noise.

## Pipeline

```
inventory → workbench → review PNGs → author decisions.json → plan → apply → diff (structural) + verify (visual)
```

### 1. Inventory

`inventory.json` carries:

- `palette[]` — every visible SOLID paint with its usages and a `bindEligible` flag per usage (false when the paint stack contains IMAGE / GRADIENT or has more than one paint). `existingProxyGuid` records the GUID of any FILL proxy whose paint already matches; the plan layer reuses it instead of synthesising a new one.
- `typography[]` — every distinct (family, style, size, lineHeight, letterSpacing) descriptor with TEXT usages. Same `existingProxyGuid` reuse hint as the palette.
- `subtreeClusters[]` — visually-confirmed clusters of repeated subtrees, identified by `clusterId` (role signature × size class).
- `unrenderable[]` — top-level frames the duplicate detector could not render (e.g. the host OS is missing the font). These never reach the workbench, so they get no agent decision in this run.

`--skip-clusters` skips the rendering pass for cluster detection — useful for a fast first look.

### 2. Workbench

Materialises one PNG (or set) per inventory entry:

```
<workbench>/
  index.json
  clusters/<id>/{contact-sheet.png, members/<i>.png}
  palette/<key>/{swatch.png, sample.png}
  typography/<key>/{sample.png}
```

`index.json` is the manifest; the agent reads PNGs through it. Render failures are recorded in `manifest.skipped.renderFailures` — for those entries the manifest still exists but the PNG path is empty, and you must not author a decision for them.

### 3. Review and curate

Run `scaffold` to get a blank `decisions.json`, then edit it directly with `Edit`. The shape:

```jsonc
{
  "clusters": {
    "<clusterId>": {
      "name": "kebab-menu",                  // empty → do nothing for this cluster
      "promoteToSymbol": true,               // only honoured when the cluster passes the leaf-icon check
      "exemplarGuid": "1:234",               // optional; defaults to the lex-smallest member guid
      "memberOverrides": {                   // optional; per-member rename override
        "1:567": "kebab-menu/disabled"
      }
    }
  },
  "palette": {
    "<colorKey>": { "name": "brand-red" }
  },
  "typography": {
    "<styleKey>": { "name": "body" },
    "<alias-styleKey>": { "name": "", "merge": "<styleKey>" }
  }
}
```

The `merge` field is optional and only relevant on `typography[]` entries that surfaced as a near-duplicate of another. Set `merge` to another entry's key to redirect every bind action onto the target's proxy. Leave `name` empty on the alias side: a merged entry has no proxy of its own. Merge chains (A → B → C) are rejected at plan time; bind directly to the leaf target.

Reading the workbench:

- **Clusters** — open `contact-sheet.png`. All members must look like instances of one component for `promoteToSymbol` to be safe; even one outlier means the strict-fingerprint check will exclude it (and that's the right call). Name what you can identify with confidence — leave the rest empty. Use `memberOverrides` only when one specific clone needs a divergent name (e.g. a "disabled" variant of an otherwise-identical icon); the default is the cluster name.
- **Palette** — open `swatch.png` and `sample.png`. Confirm the colour's role before naming. Multi-paint usages are already excluded from binding by the analyser; you only choose the name. If `existingProxyName` is set, the plan layer will reuse it instead of synthesising a duplicate proxy — naming is still required to opt into binding at all.
- **Typography** — open `sample.png`. Pick a name that describes role (heading, body, caption…), not visual size.

### 4. Plan

```
plan <fig> --inventory <dir> --decisions <decisions.json> --out <plan.json>
```

Actions emit in a fixed order so the apply step can refer to created proxies by token before binding to them:

0. `ensure-internal-canvas` — emitted only when the source lacks an Internal Only Canvas AND the plan calls for at least one `create-*-proxy`. Apply inserts a fresh DOCUMENT-rooted `CANVAS { internalOnly: true }` and every subsequent `create-*-proxy` parents under it.
1. `create-fill-proxy` — create a FILL proxy. Apply prefers cloning an existing template; if none exist it bootstraps one from scratch.
2. `create-text-proxy` — same shape, for TEXT proxies (bootstrap path leaves `derivedTextData` for Figma to rebuild on next open).
3. `bind-fill-style` — point a node's `styleIdForFill` at either an existing proxy GUID or a token from step 1.
4. `bind-text-style` — same idea for the text style. When the decision carries `merge: <otherKey>`, every bind for this entry's usages is redirected onto the merge target's resolved proxy (existing GUID or a token from step 2 for the target). No `create-text-proxy` is emitted for the alias side.
5. `promote-icon-cluster` — turn one cluster member into a SYMBOL and the rest into INSTANCEs. The descendant set is no longer restricted to leaf icons; clusters carrying TEXT, IMAGE-fill, or nested INSTANCE descendants are promotable as long as the strict-fingerprint check confirms identity.
6. `group-as-variant-set` — group N promoted SYMBOLs (each from a `promote-icon-cluster` earlier in the same plan) under a new FRAME with `isStateGroup = true` and a single VARIANT-typed `componentPropDefs[]` entry. Each grouped SYMBOL is renamed to `<propertyName>=<value>` and re-parented onto the new FRAME. Source: `decisions.variantSets`.
7. `set-layout` — adopt an auto-layout inference on a FRAME: patches `stackMode`, `stackSpacing`, `stackHorizontalPadding / stackVerticalPadding / stackPaddingRight / stackPaddingBottom`. Source: `decisions.layouts[guid].apply = true` matched against `inventory.layoutHints[]`.
8. `rename` — set node names; cluster names propagate to every member, with `memberOverrides` taking precedence. The exemplar SYMBOL of a cluster that ends up in a variant set is *not* renamed here — the variant-set action's `Prop=Value` name takes precedence.

Diagnostics:

- `skippedNonPromotableClusters` — the agent asked to promote a cluster whose exemplar carries a descendant the gate refuses (currently: GRADIENT paints, or unsupported node kinds). The rename still runs but no SYMBOL is created.

### 5. Apply

```
apply <fig> --plan <plan.json> --out <out.fig>
```

Output line:

```
refine-fig apply: [createdInternalCanvas=1] createdFillProxies=N createdTextProxies=N
                  boundFill=N boundText=N
                  clustersPromoted=N instancesRewritten=N
                  renamed=N skipped=N
```

`createdInternalCanvas=1` only appears when the plan inserted a new Internal Only Canvas. Apply does no policy. It walks the plan in order, refuses unknown action kinds, and records every skipped action with a structured `reason`. Common reasons:

- `"no internal canvas; plan must emit ensure-internal-canvas first"` — a `create-*-proxy` action ran without an Internal Only Canvas in state. The plan should have prepended an `ensure-internal-canvas`; investigate why it did not (likely a bug if the source lacks the canvas and the agent named at least one palette / typography entry).
- `"proxy token did not resolve"` — a `bind-*` action referenced a `create-*-proxy` token that was itself skipped (rare; usually a corrupt plan). Fix the upstream creation skip first.
- `"node not in nodeChanges"` — the GUID disappeared from the file between plan and apply (e.g. componentize removed it as a SYMBOL descendant). Expected when promote actions run before bind actions on the same subtree; not expected otherwise.
- `"empty newName"` — a rename action carried no name. Should not happen if `decisions.json` was scaffolded by this CLI.
- `"loaded file has no DOCUMENT node"` — `ensure-internal-canvas` ran on a file with no DOCUMENT root. This is a corrupt fixture; the file is not a valid Figma export.

Apply no longer throws on missing Internal Only Canvas — that case is now handled by the `ensure-internal-canvas` plan action. Files truly missing the DOCUMENT root remain a fail-fast condition.

### 6. Confirm

Run **both**:

```
diff   <input.fig> <out.fig>
verify <input.fig> <out.fig> --out <dir>
```

`diff` is the truth for fidelity. The expected shape after a clean apply:

- `imageFillLost = 0`
- `imageFillOrphan = 0`
- `blobRewired = 0`
- `parentMoved = 0`
- `missing = (#descendants you intentionally absorbed into SYMBOLs)`
- `typeChanged = (#promoted SYMBOLs + #rewritten INSTANCEs)`
- `added = (#new style proxies you created) + (1 if ensure-internal-canvas fired, else 0)`

Anything else is a regression — investigate. `verify`'s pixel diff is informational; expect non-zero values from rasteriser noise even on an empty plan, because round-tripping a complex file through the renderer is not pixel-identical to the original Figma export.

## Builder primitives

All mutations go through these entry points from `@higma-document-io/fig/roundtrip` — anything else is a SoT violation:

- `loadFigFile(bytes)` / `saveFigFile(loaded, options?)` — round-trip IO.
- `addNodeChange(loaded, node)` — append a brand-new node (used by proxy synthesis / bootstrap).
- `addBlob(loaded, blob)` — append a brand-new commands blob and return its index. Used by `bootstrap-fill` to append the swatch-shape geometry when the file has no template proxy to clone.
- `patchNodeChange(loaded, guidString, partial)` — shallow-merge a patch onto an existing node (used by bind / rename / promote). No-op when the GUID is unknown; returns a boolean.
- `createGuidAllocator(loaded)` — stateful allocator that hands out a fresh `(sessionID, localID)` for every new node in a single mutation pass. Always reuse one allocator per `applyPlan` call.
- `findNodeByName(loaded, name)` / `findNodesByType(loaded, typeName)` — read-only lookups.

The refine-fig modules `apply/`, `proxies/synthesise-fill.ts`, `proxies/synthesise-text.ts`, `proxies/bootstrap-fill.ts`, `proxies/bootstrap-text.ts`, and `componentize/promote-icon-cluster.ts` are the only places that should touch `loaded.nodeChanges` / `loaded.blobs` directly, and they all rely on the primitives above.

## Pitfalls

- **Pixel diff alone is misleading.** The codebase's round-trip pipeline introduces non-zero rasteriser noise; treat `diff` (structural) as the source of truth for "did anything actually change".
- **Heuristic naming is forbidden.** If you find yourself wondering "what should this cluster be called?" and don't have a defensible answer from the contact sheet, leave the name empty.
- **Strict promote is conservative.** If `instancesRewritten` is lower than the cluster's member count, the leftover members are clones whose fingerprint diverged from the exemplar (different text content, different IMAGE `imageRef`, different nested-symbol target, different opacity, …) — they correctly stayed as plain frames. Look at them in the workbench to understand why.
- **Frames in `inventory.unrenderable[]`** are rendered nowhere in the workbench; you cannot make decisions for them in this run. Tell the user which fonts to install if cluster naming depends on text inside.

## Out of scope

- **Promoting clusters with GRADIENT paints.** Gradient handle positions are node-relative, so a SYMBOL/INSTANCE flip silently changes the gradient's direction once the INSTANCE's transform diverges from the exemplar. `isPromotableCluster` refuses these; `skippedNonPromotableClusters` reports them. The rename still runs.

### Variant sets

Figma's user-facing "Component Set" / "Variant Set" concept has **no on-disk NodeType**: `figma-schema.json` only declares `SYMBOL` (value 15) and `INSTANCE` (value 16). A variant set is encoded as a FRAME with `isStateGroup = true` and a `componentPropDefs[]` array containing one or more `{ type: VARIANT }` entries; its direct children are sibling SYMBOLs named `<propertyName>=<value>` (multi-property values are comma-separated). The codebase's `findVariantContainer` / `isVariantSetFrame` resolvers already recognise this shape.

The skill exposes this through `decisions.variantSets`:

```jsonc
{
  "variantSets": {
    "Card": {
      "propertyName": "Suit",
      "variants": {
        "Spades":   "<clusterId-for-spades>",
        "Hearts":   "<clusterId-for-hearts>",
        "Diamonds": "<clusterId-for-diamonds>",
        "Clubs":    "<clusterId-for-clubs>"
      }
    }
  }
}
```

Constraints (all enforced at plan time — apply has nothing to untangle):

- Every cluster cited in a variant set must also carry `decisions.clusters[id] = { name, promoteToSymbol: true, ... }`. Only promoted SYMBOLs are groupable.
- A single cluster cannot appear in more than one variant set.
- The cited cluster's promote action must have actually fired — if `isPromotableCluster` refused the exemplar (e.g. GRADIENT paints), the variant-set plan throws so the agent can either fix the cluster or drop it from the set.

Apply moves every grouped SYMBOL under the new FRAME and rewrites its name to `<propertyName>=<value>`. The plan layer suppresses the generic cluster-name rename for the exemplar SYMBOL so the variant naming is not clobbered.

For multi-property variant sets (e.g. `Size=Small, Suit=Spades`), put the full `<prop1>=<val1>, <prop2>=<val2>` string in the variants map's value column and use the appropriate `propertyName`. Multi-property support is single-action; a future revision may surface separate `propertyDefs[]`.

### Auto-layout

`inventory.layoutHints[]` reports FRAMEs whose direct children form a uniform single-axis stack (HORIZONTAL or VERTICAL) with consistent cross-axis size and uniform inter-child gaps. The analyser refuses ambiguity:

- mixed cross-axis position or size → no hint
- non-uniform gaps → no hint
- overlapping primary-axis rectangles → no hint
- both axes pass simultaneously (degenerate single-point children) → no hint
- any invisible direct child → no hint (cannot infer its role)

A hint is a fact about geometry; turning it into an auto-layout adoption is the agent's call:

```jsonc
{
  "layouts": {
    "1:114": { "apply": true }
  }
}
```

Only `apply: true` opts in; `apply: false` is rejected at plan time (it would be a no-op typo). The plan emits one `set-layout` action per opted-in hint, patching `stackMode` (HORIZONTAL=1 / VERTICAL=2), `stackSpacing`, and per-side padding (`stackHorizontalPadding` / `stackPaddingRight` / `stackVerticalPadding` / `stackPaddingBottom`). The inferred values are used verbatim — there is no override channel by design, since the inventory review is the authoritative agent signal.

Auto-layout is single-axis and uniform-gap only. Grids, wrap-rows, and per-child sizing variations (FILL/HUG) are out of scope for this revision. If a FRAME's content is a grid (multiple rows × columns), the hint is intentionally not emitted; encode the grid manually if needed.
