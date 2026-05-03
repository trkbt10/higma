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
import noCoreBarrelImport from "./rules/no-core-barrel-import.js";
import noCoreReverseDependency from "./rules/no-core-reverse-dependency.js";
import noSubpathBypass from "./rules/no-subpath-bypass.js";

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
    "no-core-barrel-import": noCoreBarrelImport,
    "no-core-reverse-dependency": noCoreReverseDependency,
    "no-subpath-bypass": noSubpathBypass,
  },
};
