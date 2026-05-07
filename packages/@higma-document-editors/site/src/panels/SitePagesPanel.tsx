/**
 * @file Site page/surface selection panel.
 */

import type { CSSProperties } from "react";
import type { SiteRenderSurface } from "@higma-document-renderers/site";
import { fontTokens, spacingTokens } from "@higma-editor-kernel/ui/design-tokens";
import { ToggleButton } from "@higma-editor-kernel/ui/primitives/ToggleButton";
import { OptionalPropertySection } from "@higma-editor-surfaces/controls/ui";

import { useSiteEditor } from "../context/SiteEditorContext";

const pageListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: spacingTokens.xs,
};

const pageButtonStyle: CSSProperties = {
  width: "100%",
  height: "auto",
  minHeight: 44,
  justifyContent: "flex-start",
  padding: `${spacingTokens.xs} ${spacingTokens.sm}`,
  textAlign: "left",
};

const pageButtonContentStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 2,
  minWidth: 0,
};

const pageLabelStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const pageMetaStyle: CSSProperties = {
  color: "inherit",
  opacity: 0.72,
  fontSize: fontTokens.size.sm,
  fontWeight: fontTokens.weight.normal,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function createSurfaceTitle(surface: SiteRenderSurface): string {
  if (surface.label === surface.id) {
    return surface.label;
  }
  return `${surface.label} ${surface.id}`;
}

function createSurfaceMeta(surface: SiteRenderSurface): string {
  return `${surface.breakpointNames.join(", ")} / ${surface.bounds.width}x${surface.bounds.height}`;
}

function SurfaceButton({ surface }: { readonly surface: SiteRenderSurface }) {
  const { activeSurfaceId, setActiveSurfaceId } = useSiteEditor();
  const pressed = activeSurfaceId === surface.id;
  return (
    <ToggleButton
      label={createSurfaceTitle(surface)}
      ariaLabel={`Site page ${createSurfaceTitle(surface)}`}
      pressed={pressed}
      onChange={(nextPressed) => {
        if (nextPressed) {
          setActiveSurfaceId(surface.id);
        }
      }}
      style={pageButtonStyle}
    >
      <span style={pageButtonContentStyle}>
        <span style={pageLabelStyle}>{surface.label}</span>
        <span style={pageMetaStyle}>{createSurfaceMeta(surface)}</span>
      </span>
    </ToggleButton>
  );
}

/** Select the site surface that is being graphically edited. */
export function SitePagesPanel() {
  const { workspace } = useSiteEditor();
  return (
    <OptionalPropertySection title="Pages" badge={workspace.surfaces.length} defaultExpanded>
      <div role="list" aria-label="Site pages" style={pageListStyle}>
        {workspace.surfaces.map((surface) => (
          <SurfaceButton key={surface.id} surface={surface} />
        ))}
      </div>
    </OptionalPropertySection>
  );
}
