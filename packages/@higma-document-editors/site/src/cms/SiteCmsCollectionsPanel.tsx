/**
 * @file Collections sidebar — Webflow-style list of collections.
 */

import { useCallback } from "react";
import type { CSSProperties } from "react";
import { AddIcon, TableIcon } from "@higma-editor-kernel/ui/icons";
import { IconButton } from "@higma-editor-kernel/ui/primitives/IconButton";
import { Tabs, type TabItem } from "@higma-editor-kernel/ui/primitives/Tabs";
import {
  colorTokens,
  fontTokens,
  iconTokens,
  radiusTokens,
  spacingTokens,
} from "@higma-editor-kernel/ui/design-tokens";

import { sitePanelRootStyle } from "../panels/site-panel-styles";
import { useSiteCms } from "./SiteCmsContext";
import { getSiteCollectionDisplayName } from "./SiteCmsPresentation";
import type { SiteCollection } from "../domain/site-collections";

type CollectionsTabId = "edit" | "connect";

const CONTAINER_STYLE: CSSProperties = {
  ...sitePanelRootStyle,
  padding: spacingTokens.sm,
  gap: spacingTokens.sm,
  overflowY: "auto",
};

const SECTION_HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  paddingInline: spacingTokens.xs,
};

const SECTION_TITLE_STYLE: CSSProperties = {
  fontSize: fontTokens.size.sm,
  fontWeight: fontTokens.weight.semibold,
  color: colorTokens.text.secondary,
  textTransform: "uppercase",
  letterSpacing: fontTokens.letterSpacing.uppercase,
};

const COLLECTION_LIST_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  marginTop: spacingTokens.xs,
};

const CONNECT_PLACEHOLDER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flex: 1,
  padding: spacingTokens.md,
  color: colorTokens.text.tertiary,
  fontSize: fontTokens.size.sm,
  textAlign: "center",
};

function collectionRowStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: spacingTokens.xs,
    paddingBlock: spacingTokens.xs,
    paddingInline: spacingTokens.sm,
    border: "none",
    background: active ? colorTokens.background.tertiary : "transparent",
    color: active ? colorTokens.text.primary : colorTokens.text.secondary,
    borderRadius: radiusTokens.sm,
    cursor: "pointer",
    fontSize: fontTokens.size.md,
    fontFamily: "inherit",
    textAlign: "left",
    width: "100%",
  };
}

const COLLECTION_LABEL_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function CollectionRow({
  collection,
  index,
}: {
  readonly collection: SiteCollection;
  readonly index: number;
}) {
  const { activeCollection, setActiveCollectionId } = useSiteCms();
  const active = activeCollection?.id === collection.id;
  const handleClick = useCallback(() => {
    setActiveCollectionId(collection.id);
  }, [collection.id, setActiveCollectionId]);

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      style={collectionRowStyle(active)}
      onClick={handleClick}
      title={collection.id}
    >
      <TableIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />
      <span style={COLLECTION_LABEL_STYLE}>{getSiteCollectionDisplayName(collection, index)}</span>
    </button>
  );
}

function EditTabContent() {
  const { collections } = useSiteCms();

  return (
    <div>
      <div style={SECTION_HEADER_STYLE}>
        <span style={SECTION_TITLE_STYLE}>Collections</span>
        <IconButton
          icon={<AddIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />}
          size="sm"
          variant="ghost"
          disabled
          ariaLabel="Add collection"
          title="Adding a new collection requires a CMS backend not provided by the .site source."
        />
      </div>
      <div role="listbox" aria-label="Collections" style={COLLECTION_LIST_STYLE}>
        {collections.length === 0 && (
          <p style={{ color: colorTokens.text.tertiary, padding: spacingTokens.xs, fontSize: fontTokens.size.sm }}>
            This document does not reference any CMS collection.
          </p>
        )}
        {collections.map((collection, index) => (
          <CollectionRow key={collection.id} collection={collection} index={index} />
        ))}
      </div>
    </div>
  );
}

function ConnectTabContent() {
  return (
    <p style={CONNECT_PLACEHOLDER_STYLE}>
      Connecting external CMS sources requires a backend integration not provided by the .site source.
    </p>
  );
}

const TABS: readonly TabItem<CollectionsTabId>[] = [
  { id: "edit", label: "Edit", content: <EditTabContent /> },
  { id: "connect", label: "Connect", content: <ConnectTabContent />, disabled: true },
];

/** Sidebar showing every collection plus the Edit / Connect mode tabs. */
export function SiteCmsCollectionsPanel() {
  return (
    <div style={CONTAINER_STYLE} aria-label="Collections sidebar">
      <Tabs<CollectionsTabId> items={TABS} defaultValue="edit" size="sm" />
    </div>
  );
}
