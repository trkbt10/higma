/**
 * @file Collections sidebar — Webflow-style list of collections with CRUD.
 */

import { useCallback } from "react";
import type { CSSProperties } from "react";
import { AddIcon, TableIcon, TrashIcon } from "@higma-editor-kernel/ui/icons";
import { IconButton } from "@higma-editor-kernel/ui/primitives/IconButton";
import { Tabs, type TabItem } from "@higma-editor-kernel/ui/primitives/Tabs";
import { InlineRenameLabel } from "@higma-editor-surfaces/controls/ui";
import {
  colorTokens,
  fontTokens,
  iconTokens,
  radiusTokens,
  spacingTokens,
} from "@higma-editor-kernel/ui/design-tokens";

import { sitePanelRootStyle } from "../panels/site-panel-styles";
import { useSiteCms } from "./SiteCmsContext";
import { isSiteCmsDraftId, selectCollectionDisplayName } from "./site-cms-state";
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

const DRAFT_BADGE_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  paddingInline: spacingTokens.xs,
  height: 18,
  borderRadius: radiusTokens.sm,
  background: colorTokens.accent.primary,
  color: colorTokens.text.inverse,
  fontSize: fontTokens.size.xs,
  fontWeight: fontTokens.weight.medium,
  marginInlineStart: spacingTokens.xs,
};

function collectionRowStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: spacingTokens.xs,
    paddingBlock: spacingTokens.xs,
    paddingInline: spacingTokens.sm,
    background: active ? colorTokens.background.tertiary : "transparent",
    color: active ? colorTokens.text.primary : colorTokens.text.secondary,
    borderRadius: radiusTokens.sm,
    cursor: "pointer",
    fontSize: fontTokens.size.md,
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
  const {
    activeCollection,
    setActiveCollectionId,
    state,
    renameCollection,
    deleteDraftCollection,
  } = useSiteCms();
  const active = activeCollection?.id === collection.id;
  const draft = isSiteCmsDraftId(collection.id);
  const override = selectCollectionDisplayName(state, collection.id);
  const displayName = getSiteCollectionDisplayName(collection, index, override);

  const handleSelect = useCallback(() => {
    setActiveCollectionId(collection.id);
  }, [collection.id, setActiveCollectionId]);

  const handleRename = useCallback(
    (next: string) => {
      renameCollection({ collectionId: collection.id, displayName: next });
    },
    [collection.id, renameCollection],
  );

  const handleDelete = useCallback(() => {
    deleteDraftCollection({ collectionId: collection.id });
  }, [collection.id, deleteDraftCollection]);

  return (
    <div
      role="option"
      aria-selected={active}
      style={collectionRowStyle(active)}
      onClick={handleSelect}
      title={collection.id}
    >
      <TableIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />
      <span style={COLLECTION_LABEL_STYLE}>
        <InlineRenameLabel label={displayName} onRename={handleRename} />
      </span>
      {draft && <span style={DRAFT_BADGE_STYLE}>Draft</span>}
      {draft && (
        <IconButton
          icon={<TrashIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />}
          ariaLabel={`Delete collection ${displayName}`}
          variant="ghost"
          size="sm"
          style={{ width: 22, height: 22, padding: 0 }}
          onClick={(event) => {
            event.stopPropagation();
            handleDelete();
          }}
        />
      )}
    </div>
  );
}

function EditTabContent() {
  const { collections, addDraftCollection } = useSiteCms();
  const handleAdd = useCallback(() => {
    addDraftCollection();
  }, [addDraftCollection]);

  return (
    <div>
      <div style={SECTION_HEADER_STYLE}>
        <span style={SECTION_TITLE_STYLE}>Collections</span>
        <IconButton
          icon={<AddIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />}
          size="sm"
          variant="ghost"
          ariaLabel="Add collection"
          onClick={handleAdd}
        />
      </div>
      <div role="listbox" aria-label="Collections" style={COLLECTION_LIST_STYLE}>
        {collections.length === 0 && (
          <p style={{ color: colorTokens.text.tertiary, padding: spacingTokens.xs, fontSize: fontTokens.size.sm }}>
            No collections yet. Click + to add one.
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
