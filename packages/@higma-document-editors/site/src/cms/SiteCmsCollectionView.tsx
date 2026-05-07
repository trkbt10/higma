/**
 * @file Center pane: items table + responsive item-editor overlay for the active collection.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { AddIcon, ChevronLeftIcon, SettingsIcon, TrashIcon } from "@higma-editor-kernel/ui/icons";
import { Button } from "@higma-editor-kernel/ui/primitives/Button";
import { Checkbox } from "@higma-editor-kernel/ui/primitives/Checkbox";
import { IconButton } from "@higma-editor-kernel/ui/primitives/IconButton";
import { Select } from "@higma-editor-kernel/ui/primitives/Select";
import { InlineRenameLabel } from "@higma-editor-surfaces/controls/ui";
import { useContainerWidth } from "@higma-editor-surfaces/controls/editor-shell";
import {
  colorTokens,
  fontTokens,
  iconTokens,
  radiusTokens,
  spacingTokens,
} from "@higma-editor-kernel/ui/design-tokens";

import { sitePanelRootStyle } from "../panels/site-panel-styles";
import { useSiteCms } from "./SiteCmsContext";
import {
  isSiteCmsDraftId,
  selectCollectionDisplayName,
  selectFieldDisplayName,
} from "./site-cms-state";
import { SiteCmsItemEditor } from "./SiteCmsItemEditor";
import { SiteCollectionFieldIcon } from "./SiteCollectionFieldIcon";
import {
  getSiteCollectionDisplayName,
  getSiteCollectionFieldDisplayName,
  getSiteCollectionItemDisplayName,
} from "./SiteCmsPresentation";
import {
  findSiteCollectionItemValue,
  type SiteCollection,
  type SiteCollectionField,
  type SiteCollectionItem,
} from "../domain/site-collections";
import type { SiteCollectionFieldKind } from "../domain/site-collection-field-kind";

const FIELD_KIND_OPTIONS: readonly { readonly value: SiteCollectionFieldKind; readonly label: string }[] = [
  { value: "text", label: "Text" },
  { value: "rich-text", label: "Rich Text" },
  { value: "image", label: "Image" },
  { value: "date", label: "Date" },
  { value: "link", label: "Link" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Toggle" },
];

const ROOT_STYLE: CSSProperties = {
  ...sitePanelRootStyle,
  background: colorTokens.background.secondary,
  position: "relative",
};

const HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: spacingTokens.sm,
  padding: `${spacingTokens.sm} ${spacingTokens.md}`,
  borderBottom: `1px solid ${colorTokens.border.subtle}`,
  background: colorTokens.background.primary,
  flexWrap: "wrap",
};

const TITLE_STYLE: CSSProperties = {
  fontSize: fontTokens.size.lg,
  fontWeight: fontTokens.weight.semibold,
  color: colorTokens.text.primary,
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

const HEADER_TRAILING_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: spacingTokens.xs,
  marginInlineStart: "auto",
};

const FIELDS_EDITOR_STYLE: CSSProperties = {
  width: "100%",
  borderTop: `1px solid ${colorTokens.border.subtle}`,
  background: colorTokens.background.secondary,
  padding: spacingTokens.md,
  display: "flex",
  flexDirection: "column",
  gap: spacingTokens.sm,
};

const FIELDS_EDITOR_FORM_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: spacingTokens.sm,
};

const TABLE_AREA_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  position: "relative",
  display: "flex",
  flexDirection: "row",
};

const TABLE_SHELL_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflow: "auto",
  padding: spacingTokens.md,
};

const TABLE_STYLE: CSSProperties = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  background: colorTokens.background.primary,
  borderRadius: radiusTokens.md,
  border: `1px solid ${colorTokens.border.subtle}`,
  overflow: "hidden",
};

const HEADER_CELL_STYLE: CSSProperties = {
  padding: `${spacingTokens.sm} ${spacingTokens.md}`,
  borderBottom: `1px solid ${colorTokens.border.subtle}`,
  background: colorTokens.background.primary,
  fontSize: fontTokens.size.sm,
  fontWeight: fontTokens.weight.medium,
  color: colorTokens.text.tertiary,
  textAlign: "left",
  whiteSpace: "nowrap",
};

const HEADER_LABEL_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: spacingTokens.xs,
};

const INDEX_CELL_STYLE: CSSProperties = {
  ...HEADER_CELL_STYLE,
  width: 56,
  textAlign: "center",
};

const CHECKBOX_CELL_STYLE: CSSProperties = {
  ...HEADER_CELL_STYLE,
  width: 32,
  textAlign: "center",
};

function rowStyle(active: boolean): CSSProperties {
  return {
    cursor: "pointer",
    background: active ? colorTokens.background.tertiary : "transparent",
    transition: "background-color 0.1s ease",
  };
}

const BODY_INDEX_CELL_STYLE: CSSProperties = {
  width: 56,
  padding: `${spacingTokens.sm} ${spacingTokens.md}`,
  borderBottom: `1px solid ${colorTokens.border.subtle}`,
  color: colorTokens.text.tertiary,
  fontSize: fontTokens.size.sm,
  textAlign: "center",
};

const BODY_CHECKBOX_CELL_STYLE: CSSProperties = {
  width: 32,
  padding: `${spacingTokens.sm} ${spacingTokens.md}`,
  borderBottom: `1px solid ${colorTokens.border.subtle}`,
  textAlign: "center",
};

const BODY_CELL_STYLE: CSSProperties = {
  padding: `${spacingTokens.sm} ${spacingTokens.md}`,
  borderBottom: `1px solid ${colorTokens.border.subtle}`,
  color: colorTokens.text.primary,
  fontSize: fontTokens.size.md,
  maxWidth: 320,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const NEW_ITEM_ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: spacingTokens.sm,
  padding: `${spacingTokens.sm} ${spacingTokens.md}`,
  color: colorTokens.text.tertiary,
  fontSize: fontTokens.size.md,
  cursor: "pointer",
  background: "transparent",
  border: "none",
  width: "100%",
  textAlign: "left",
};

const EMPTY_STATE_STYLE: CSSProperties = {
  padding: spacingTokens.lg,
  textAlign: "center",
  color: colorTokens.text.tertiary,
  fontSize: fontTokens.size.md,
};

const SPLIT_PANE_PANEL_WIDTH = 420;
const SPLIT_PANE_BREAKPOINT = 720;

const SPLIT_PANEL_STYLE: CSSProperties = {
  width: SPLIT_PANE_PANEL_WIDTH,
  flexShrink: 0,
  background: colorTokens.background.primary,
  borderLeft: `1px solid ${colorTokens.border.subtle}`,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

const OVERLAY_PANEL_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: colorTokens.background.primary,
  zIndex: 6,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

function FieldHeaderCell({
  collection,
  field,
  index,
}: {
  readonly collection: SiteCollection;
  readonly field: SiteCollectionField;
  readonly index: number;
}) {
  const { state, renameField } = useSiteCms();
  const override = selectFieldDisplayName(state, collection.id, field.id);
  const displayName = getSiteCollectionFieldDisplayName(field, index, override);
  const draft = isSiteCmsDraftId(field.id);
  const handleRename = useCallback(
    (next: string) => {
      renameField({ collectionId: collection.id, fieldId: field.id, displayName: next });
    },
    [collection.id, field.id, renameField],
  );
  return (
    <th scope="col" style={HEADER_CELL_STYLE} title={`${field.id} (${field.kind})`}>
      <span style={HEADER_LABEL_STYLE}>
        <SiteCollectionFieldIcon kind={field.kind} />
        <InlineRenameLabel label={displayName} onRename={handleRename} />
        {draft && <span style={DRAFT_BADGE_STYLE}>Draft</span>}
      </span>
    </th>
  );
}

function FieldBodyCell({ field, item }: { readonly field: SiteCollectionField; readonly item: SiteCollectionItem }) {
  const value = findSiteCollectionItemValue(item, field.id);
  if (value.text === null || value.text.trim() === "") {
    return <td style={{ ...BODY_CELL_STYLE, color: colorTokens.text.tertiary }}>—</td>;
  }
  return <td style={BODY_CELL_STYLE} title={value.text}>{value.text}</td>;
}

function ItemRow({
  collection,
  item,
  index,
  selected,
  onToggleSelect,
}: {
  readonly collection: SiteCollection;
  readonly item: SiteCollectionItem;
  readonly index: number;
  readonly selected: boolean;
  readonly onToggleSelect: (itemId: string, next: boolean) => void;
}) {
  const { activeItem, setActiveItemId, deleteDraftItem } = useSiteCms();
  const active = activeItem?.id === item.id;
  const itemDisplayName = getSiteCollectionItemDisplayName(item);
  const draft = isSiteCmsDraftId(item.id);

  const handleOpen = useCallback(() => {
    setActiveItemId(item.id);
  }, [item.id, setActiveItemId]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableRowElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleOpen();
      }
    },
    [handleOpen],
  );

  const handleDelete = useCallback(() => {
    deleteDraftItem({ collectionId: collection.id, itemId: item.id });
  }, [collection.id, deleteDraftItem, item.id]);

  return (
    <tr
      role="button"
      aria-pressed={active}
      tabIndex={0}
      style={rowStyle(active)}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      aria-label={`Open item ${itemDisplayName}`}
    >
      <td
        style={BODY_CHECKBOX_CELL_STYLE}
        onClick={(event) => event.stopPropagation()}
      >
        <Checkbox
          checked={selected}
          onChange={(next: boolean) => onToggleSelect(item.id, next)}
          ariaLabel={`Select item ${itemDisplayName}`}
        />
      </td>
      <td style={BODY_INDEX_CELL_STYLE}>
        {index + 1}
        {draft && <span style={DRAFT_BADGE_STYLE}>Draft</span>}
      </td>
      {collection.fields.map((field) => (
        <FieldBodyCell key={field.id} field={field} item={item} />
      ))}
      <td
        style={BODY_CHECKBOX_CELL_STYLE}
        onClick={(event) => event.stopPropagation()}
      >
        {draft && (
          <IconButton
            icon={<TrashIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />}
            ariaLabel={`Delete item ${itemDisplayName}`}
            variant="ghost"
            size="sm"
            style={{ width: 22, height: 22, padding: 0 }}
            onClick={handleDelete}
          />
        )}
      </td>
    </tr>
  );
}

function NewItemRow({ collection }: { readonly collection: SiteCollection }) {
  const { addDraftItem } = useSiteCms();
  const handleClick = useCallback(() => {
    addDraftItem({ collectionId: collection.id });
  }, [addDraftItem, collection.id]);
  return (
    <button type="button" style={NEW_ITEM_ROW_STYLE} onClick={handleClick}>
      <AddIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />
      <span>New item</span>
    </button>
  );
}

function NoItems({ collection }: { readonly collection: SiteCollection }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: spacingTokens.sm, padding: spacingTokens.lg }}>
      <p style={EMPTY_STATE_STYLE}>This collection has no items yet.</p>
      <NewItemRow collection={collection} />
    </div>
  );
}

function FieldRowEditor({
  collection,
  field,
  index,
}: {
  readonly collection: SiteCollection;
  readonly field: SiteCollectionField;
  readonly index: number;
}) {
  const { state, renameField, deleteDraftField } = useSiteCms();
  const override = selectFieldDisplayName(state, collection.id, field.id);
  const displayName = getSiteCollectionFieldDisplayName(field, index, override);
  const draft = isSiteCmsDraftId(field.id);

  const handleRename = useCallback(
    (next: string) => {
      renameField({ collectionId: collection.id, fieldId: field.id, displayName: next });
    },
    [collection.id, field.id, renameField],
  );
  const handleDelete = useCallback(() => {
    deleteDraftField({ collectionId: collection.id, fieldId: field.id });
  }, [collection.id, deleteDraftField, field.id]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacingTokens.sm,
        paddingBlock: spacingTokens.xs,
      }}
    >
      <SiteCollectionFieldIcon kind={field.kind} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <InlineRenameLabel label={displayName} onRename={handleRename} />
      </span>
      {draft && <span style={DRAFT_BADGE_STYLE}>Draft</span>}
      {draft && (
        <IconButton
          icon={<TrashIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />}
          ariaLabel={`Delete field ${displayName}`}
          variant="ghost"
          size="sm"
          style={{ width: 22, height: 22, padding: 0 }}
          onClick={handleDelete}
        />
      )}
    </div>
  );
}

function FieldsEditor({ collection }: { readonly collection: SiteCollection }) {
  const { addDraftField } = useSiteCms();
  const [kind, setKind] = useState<SiteCollectionFieldKind>("text");
  const handleAdd = useCallback(() => {
    addDraftField({ collectionId: collection.id, kind });
  }, [addDraftField, collection.id, kind]);
  return (
    <div style={FIELDS_EDITOR_STYLE} aria-label="Fields editor">
      <span style={{ fontSize: fontTokens.size.sm, color: colorTokens.text.secondary }}>
        Double-click a field name to rename. Drafts can be deleted with the trash icon; document-derived fields cannot.
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {collection.fields.map((field, index) => (
          <FieldRowEditor key={field.id} collection={collection} field={field} index={index} />
        ))}
      </div>
      <div style={FIELDS_EDITOR_FORM_STYLE}>
        <div style={{ width: 160 }}>
          <Select<SiteCollectionFieldKind>
            value={kind}
            onChange={setKind}
            options={FIELD_KIND_OPTIONS}
            ariaLabel="New field kind"
          />
        </div>
        <Button onClick={handleAdd} variant="primary" size="sm">
          <AddIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />
          Add field
        </Button>
      </div>
    </div>
  );
}

function CollectionTable({ collection }: { readonly collection: SiteCollection }) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());

  const allSelected: boolean | "mixed" = useMemo(() => {
    if (collection.items.length === 0 || selectedIds.size === 0) {
      return false;
    }
    if (selectedIds.size === collection.items.length) {
      return true;
    }
    return "mixed";
  }, [collection.items.length, selectedIds]);

  const toggleSelect = useCallback((itemId: string, next: boolean) => {
    setSelectedIds((current) => {
      const updated = new Set(current);
      if (next) {
        updated.add(itemId);
      } else {
        updated.delete(itemId);
      }
      return updated;
    });
  }, []);

  const toggleAll = useCallback((next: boolean) => {
    setSelectedIds(() => {
      if (!next) {
        return new Set();
      }
      return new Set(collection.items.map((item) => item.id));
    });
  }, [collection.items]);

  if (collection.items.length === 0) {
    return <NoItems collection={collection} />;
  }

  return (
    <>
      <table style={TABLE_STYLE} aria-label={`Items of ${getSiteCollectionDisplayName(collection, 0)}`}>
        <thead>
          <tr>
            <th scope="col" style={CHECKBOX_CELL_STYLE}>
              <Checkbox
                checked={allSelected}
                onChange={toggleAll}
                ariaLabel="Select all items"
              />
            </th>
            <th scope="col" style={INDEX_CELL_STYLE} aria-label="Row number" />
            {collection.fields.map((field, index) => (
              <FieldHeaderCell key={field.id} collection={collection} field={field} index={index} />
            ))}
            <th scope="col" style={CHECKBOX_CELL_STYLE} aria-label="Row actions" />
          </tr>
        </thead>
        <tbody>
          {collection.items.map((item, index) => (
            <ItemRow
              key={item.id || `<context>:${index}`}
              collection={collection}
              item={item}
              index={index}
              selected={selectedIds.has(item.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
        </tbody>
      </table>
      <NewItemRow collection={collection} />
    </>
  );
}

function NoCollectionSelected() {
  return (
    <div style={EMPTY_STATE_STYLE} role="status">
      Select a collection from the sidebar to begin editing.
    </div>
  );
}

function SplitItemEditor() {
  return (
    <div style={SPLIT_PANEL_STYLE} role="region" aria-label="Item editor">
      <SiteCmsItemEditor />
    </div>
  );
}

function OverlayItemEditor() {
  return (
    <div style={OVERLAY_PANEL_STYLE} role="dialog" aria-label="Item editor">
      <SiteCmsItemEditor />
    </div>
  );
}

/** Center pane that hosts the items table for the active collection. */
export function SiteCmsCollectionView() {
  const { state, activeCollection, activeItem, setActiveCollectionId, addDraftItem } = useSiteCms();
  const [fieldsEditorOpen, setFieldsEditorOpen] = useState(false);
  const tableAreaRef = useRef<HTMLDivElement>(null);
  const tableAreaWidth = useContainerWidth(tableAreaRef);

  const handleBack = useCallback(() => {
    setActiveCollectionId(null);
  }, [setActiveCollectionId]);

  const handleAddItem = useCallback(() => {
    if (!activeCollection) {
      return;
    }
    addDraftItem({ collectionId: activeCollection.id });
  }, [activeCollection, addDraftItem]);

  const handleToggleFieldsEditor = useCallback(() => {
    setFieldsEditorOpen((current) => !current);
  }, []);

  if (!activeCollection) {
    return (
      <section style={ROOT_STYLE} aria-label="Collection view">
        <NoCollectionSelected />
      </section>
    );
  }

  const collectionOverride = selectCollectionDisplayName(state, activeCollection.id);
  const displayName = getSiteCollectionDisplayName(activeCollection, 0, collectionOverride);
  const draftCollection = isSiteCmsDraftId(activeCollection.id);
  const editorOpen = activeItem !== null;
  const useSplitLayout = editorOpen && tableAreaWidth >= SPLIT_PANE_BREAKPOINT;

  return (
    <section style={ROOT_STYLE} aria-label={`Collection ${displayName}`}>
      <header style={HEADER_STYLE}>
        <IconButton
          icon={<ChevronLeftIcon size={iconTokens.size.md} strokeWidth={iconTokens.strokeWidth} />}
          ariaLabel="Back to collections"
          onClick={handleBack}
          variant="ghost"
          size="sm"
          style={{ width: 28, height: 28, padding: 0 }}
        />
        <span style={TITLE_STYLE}>
          {displayName}
          {draftCollection && <span style={DRAFT_BADGE_STYLE}>Draft</span>}
        </span>
        <div style={HEADER_TRAILING_STYLE}>
          <Button variant="secondary" size="sm" onClick={handleAddItem}>
            <AddIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />
            New item
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleToggleFieldsEditor}
            aria-pressed={fieldsEditorOpen}
          >
            <SettingsIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />
            Edit fields
          </Button>
        </div>
        {fieldsEditorOpen && <FieldsEditor collection={activeCollection} />}
      </header>
      <div ref={tableAreaRef} style={TABLE_AREA_STYLE}>
        <div style={TABLE_SHELL_STYLE}>
          <CollectionTable collection={activeCollection} />
        </div>
        {editorOpen && useSplitLayout && <SplitItemEditor />}
        {editorOpen && !useSplitLayout && <OverlayItemEditor />}
      </div>
    </section>
  );
}
