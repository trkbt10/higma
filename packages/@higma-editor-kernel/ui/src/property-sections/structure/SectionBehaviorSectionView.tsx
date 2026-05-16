/**
 * @file Section behaviour view (presentational only)
 *
 * Renders a single toggle for "Hide section contents" semantics. The label
 * is fixed here because this is the only behaviour this view exposes; if a
 * future caller needs additional behaviours, they should be added as
 * explicit props (one per behaviour) rather than as a generic toggle.
 */

import { Toggle } from "../../primitives";

export type SectionBehaviorSectionViewProps = {
  readonly contentsHidden: boolean;
  readonly onContentsHiddenChange: (hidden: boolean) => void;
};

/** Renders the SECTION-node "hide contents" toggle. */
export function SectionBehaviorSectionView({
  contentsHidden,
  onContentsHiddenChange,
}: SectionBehaviorSectionViewProps) {
  return (
    <Toggle
      checked={contentsHidden}
      label="Hide section contents"
      ariaLabel="Hide section contents"
      onChange={onContentsHiddenChange}
    />
  );
}
