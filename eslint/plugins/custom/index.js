/**
 * @file Local ESLint plugin: custom rules for this repository.
 */
import ternaryLength from "./rules/ternary-length.js";
import preferNodeProtocol from "./rules/prefer-node-protocol.js";
import noEmptyJsdoc from "./rules/no-empty-jsdoc.js";
import noAsOutsideGuard from "./rules/no-as-outside-guard.js";
import noNestedTry from "./rules/no-nested-try.js";
import noIifeInAnonymous from "./rules/no-iife-in-anonymous.js";
import noCrossBoundaryExport from "./rules/no-cross-boundary-export.js";
import noReexportOutsideEntry from "./rules/no-reexport-outside-entry.js";
import enforceIndexImport from "./rules/enforce-index-import.js";
import noCrossPackageReexport from "./rules/no-cross-package-reexport.js";
import noSubpathBypass from "./rules/no-subpath-bypass.js";
import enforcePackageBoundaries from "./rules/enforce-package-boundaries.js";
import noInlineDfsById from "./rules/no-inline-dfs-by-id.js";

export default {
  rules: {
    "ternary-length": ternaryLength,
    "prefer-node-protocol": preferNodeProtocol,
    "no-empty-jsdoc": noEmptyJsdoc,
    "no-as-outside-guard": noAsOutsideGuard,
    "no-nested-try": noNestedTry,
    "no-iife-in-anonymous": noIifeInAnonymous,
    "no-cross-boundary-export": noCrossBoundaryExport,
    "no-reexport-outside-entry": noReexportOutsideEntry,
    "enforce-index-import": enforceIndexImport,
    "no-cross-package-reexport": noCrossPackageReexport,
    "no-subpath-bypass": noSubpathBypass,
    "enforce-package-boundaries": enforcePackageBoundaries,
    "no-inline-dfs-by-id": noInlineDfsById,
  },
};
