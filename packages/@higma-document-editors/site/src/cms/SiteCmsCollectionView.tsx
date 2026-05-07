/**
 * @file Center pane: items table for the active collection.
 */

import { useCallback, useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { AddIcon, ChevronLeftIcon, SettingsIcon } from "@higma-editor-kernel/ui/icons";
import { Button } from "@higma-editor-kernel/ui/primitives/Button";
import { Checkbox } from "@higma-editor-kernel/ui/primitives/Checkbox";
import { IconButton } from "@higma-editor-kernel/ui/primitives/IconButton";
import {
  colorTokens,
  fontTokens,
  iconTokens,
  radiusTokens,
  spacingTokens,
} from "@higma-editor-kernel/ui/design-tokens";

import { sitePanelRootStyle } from "../panels/site-panel-styles";
import { useSiteCms } from "./SiteCmsContext";
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

const ROOT_STYLE: CSSProperties = {
  ...sitePanelRootStyle,
  background: colorTokens.background.secondary,
};

const HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: spacingTokens.sm,
  padding: `${spacingTokens.sm} ${spacingTokens.md}`,
  borderBottom: `1px solid ${colorTokens.border.subtle}`,
  background: colorTokens.background.primary,
};

const TITLE_STYLE: CSSProperties = {
  fontSize: fontTokens.size.lg,
  fontWeight: fontTokens.weight.semibold,
  color: colorTokens.text.primary,
};

const HEADER_TRAILING_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: spacingTokens.xs,
  marginInlineStart: "auto",
};

const TABLE_SHELL_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
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
};

const EMPTY_STATE_STYLE: CSSProperties = {
  padding: spacingTokens.lg,
  textAlign: "center",
  color: colorTokens.text.tertiary,
  fontSize: fontTokens.size.md,
};

function FieldHeaderCell({ field, index }: { readonly field: SiteCollectionField; readonly index: number }) {
  const displayName = getSiteCollectionFieldDisplayName(field, index);
  return (
    <th scope="col" style={HEADER_CELL_STYLE} title={`${field.id} (${field.kind})`}>
      <span style={HEADER_LABEL_STYLE}>
        <SiteCollectionFieldIcon kind={field.kind} />
        {displayName}
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
  const { activeItem, setActiveItemId } = useSiteCms();
  const active = activeItem?.id === item.id;
  const itemDisplayName = getSiteCollectionItemDisplayName(item);

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
      <td style={BODY_INDEX_CELL_STYLE}>{index + 1}</td>
      {collection.fields.map((field) => (
        <FieldBodyCell key={field.id} field={field} item={item} />
      ))}
    </tr>
  );
}

function NoItems() {
  return (
    <p style={EMPTY_STATE_STYLE}>
      This collection has no items recorded in the site document.
    </p>
  );
}

function NewItemRow() {
  return (
    <div style={NEW_ITEM_ROW_STYLE} role="note" title="Adding new items requires a CMS backend not provided by the .site source.">
      <AddIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />
      <span>New item</span>
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
    return <NoItems />;
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
              <FieldHeaderCell key={field.id} field={field} index={index} />
            ))}
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
      <NewItemRow />
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

/** Center pane that hosts the items table for the active collection. */
export function SiteCmsCollectionView() {
  const { activeCollection, setActiveCollectionId } = useSiteCms();

  const handleBack = useCallback(() => {
    setActiveCollectionId(null);
  }, [setActiveCollectionId]);

  if (!activeCollection) {
    return (
      <section style={ROOT_STYLE} aria-label="Collection view">
        <NoCollectionSelected />
      </section>
    );
  }

  const displayName = getSiteCollectionDisplayName(activeCollection, 0);

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
        <span style={TITLE_STYLE}>{displayName}</span>
        <div style={HEADER_TRAILING_STYLE}>
          <Button
            variant="secondary"
            size="sm"
            disabled
            title="Adding new items requires a CMS backend not provided by the .site source."
          >
            <AddIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />
            New item
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled
            title="Editing the collection schema requires a CMS backend not provided by the .site source."
          >
            <SettingsIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />
            Edit fields
          </Button>
        </div>
      </header>
      <div style={TABLE_SHELL_STYLE}>
        <CollectionTable collection={activeCollection} />
      </div>
    </section>
  );
}
