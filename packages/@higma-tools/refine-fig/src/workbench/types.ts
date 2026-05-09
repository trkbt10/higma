/**
 * @file Workbench output shape — JSON manifest the agent reads to
 * pair each plan entry with the PNG it should look at before
 * accepting / rejecting / relabeling the proposal.
 *
 * The workbench is the skill's primary surface. The agent opens the
 * referenced PNGs with `Read`, inspects them, edits the plan, and
 * the apply step consumes the edited plan. CLI commands populate
 * this manifest; they do not make the final naming or binding call.
 */

export type RenameWorkbenchEntry = {
  readonly nodeGuid: string;
  readonly currentName: string;
  readonly suggestedName: string;
  readonly reason: string;
  readonly nodePng: string;
  readonly contextPng: string;
  /** Path of authored ancestors top-to-bottom — useful for picking better names. */
  readonly ancestorNames: readonly string[];
  /** Dominant text inside the subtree, if any. */
  readonly dominantText: string | undefined;
};

export type BindingWorkbenchEntry = {
  readonly nodeGuid: string;
  readonly nodeName: string;
  readonly proxyGuid: string;
  readonly proxyName: string;
  readonly colorHex: string;
  /** Hex JSON dump of the paint stack so the agent can see if image / gradient is involved. */
  readonly paintStack: readonly { readonly type: string; readonly summary: string }[];
  /** Single-SOLID render of the candidate node (current state). */
  readonly beforePng: string;
  /** Render with the proxy id wired in (after state). Identical pixels prove the bind is safe. */
  readonly afterPng: string;
};

export type ClusterMemberEntry = {
  readonly nodeGuid: string;
  readonly nodeName: string;
  readonly width: number;
  readonly height: number;
  readonly png: string;
};

export type ClusterWorkbenchEntry = {
  readonly clusterId: string;
  readonly suggestedName: string;
  readonly roleSignature: string;
  readonly contactSheetPng: string;
  readonly members: readonly ClusterMemberEntry[];
};

export type WorkbenchManifest = {
  readonly source: { readonly file: string; readonly bytes: number };
  readonly renames: readonly RenameWorkbenchEntry[];
  readonly bindings: readonly BindingWorkbenchEntry[];
  readonly clusters: readonly ClusterWorkbenchEntry[];
};
