/**
 * @file Operation primitives entry point.
 *
 * Operation-focused presentational primitives that map one-to-one with the
 * distinct manipulation gestures exposed by editor side-panels. Each module
 * here owns exactly one operation; document editors compose them into their
 * own section views.
 */

export {
  AlignmentControls,
  type AlignmentAxis,
  type AlignmentPosition,
  type AlignmentControlsProps,
} from "./AlignmentControls";

export {
  ConstraintAnchorGrid,
  type ConstraintAxisAnchor,
  type ConstraintAnchorCell,
  type ConstraintAnchorGridProps,
} from "./ConstraintAnchorGrid";

export {
  TransformActions,
  type TransformActionsProps,
} from "./TransformActions";
