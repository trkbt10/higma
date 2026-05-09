/**
 * @file Public entry — analysis primitives.
 */
export { analysePalette, colorKey, colorHex } from "./palette";
export type { PaletteAnalysis, PaletteEntry, PaintUsage, PaintRole, SuggestedRole } from "./palette";
export { analyseTypography } from "./text-styles";
export type { TypographyAnalysis, TypographyCluster, TypographyDescriptor, TypographyUsage, TextStyleRole } from "./text-styles";
export { structuralSignature, roleSignature, roleHintFor } from "./subtree-signature";
export type { NodeRoleHint } from "./subtree-signature";
export { detectDuplicates } from "./duplicate-clusters";
export type { DuplicateAnalysis, DuplicateCluster, DuplicateMember, UnrenderableNote } from "./duplicate-clusters";
export { proposeRenames } from "./naming";
export type { RenameProposal } from "./naming";
