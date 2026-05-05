/**
 * @file SSoT: structural tree deletion by identifier.
 */

export type RemoveByIdOptions<TNode> = {
  readonly getId: (node: TNode) => string;
  readonly getChildren: (node: TNode) => readonly TNode[] | undefined;
  readonly withChildren: (node: TNode, children: readonly TNode[]) => TNode;
};

export type RemoveByIdResult<TNode> = {
  readonly nodes: readonly TNode[];
  readonly removed: boolean;
};

/**
 * Remove matching subtrees whose `getId(node)` equals `id`, preserving
 * structural sharing for branches that do not change. Lookup-only code
 * must use `dfsById`; this primitive owns deletion semantics.
 */
export function removeById<TNode>(
  roots: readonly TNode[],
  id: string,
  opts: RemoveByIdOptions<TNode>,
): RemoveByIdResult<TNode> {
  const result = roots.flatMap((root) => {
    if (opts.getId(root) === id) {
      return [];
    }
    const children = opts.getChildren(root);
    if (!children) {
      return [root];
    }
    const childResult = removeById(children, id, opts);
    if (!childResult.removed) {
      return [root];
    }
    return [opts.withChildren(root, childResult.nodes)];
  });
  const removed = result.length !== roots.length || result.some((node, index) => node !== roots[index]);
  return {
    nodes: removed ? result : roots,
    removed,
  };
}
