/** @file Tree-walking SSoT primitives. */
export {
  dfsById,
  dfsByIdWithContext,
  type DfsByIdOptions,
  type DfsByIdWithContextOptions,
  type DfsByIdWithContextResult,
} from "./dfs-by-id";
export { removeById, type RemoveByIdOptions, type RemoveByIdResult } from "./remove-by-id";
export { walkTree, type WalkTreeOptions } from "./walk-tree";
