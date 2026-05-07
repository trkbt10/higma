/**
 * @file Right-drawer item editor for the active CMS item.
 */

import { useCallback } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from "@higma-editor-kernel/ui/icons";
import { IconButton } from "@higma-editor-kernel/ui/primitives/IconButton";
import { Input } from "@higma-editor-kernel/ui/primitives/Input";
import { FieldGroup } from "@higma-editor-kernel/ui/layout";
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
  type SiteCollectionItemValue,
} from "../domain/site-collections";
import type { SiteCollectionFieldKind } from "../domain/site-collection-field-kind";

const ROOT_STYLE: CSSProperties = {
  ...sitePanelRootStyle,
  background: colorTokens.background.primary,
};

const HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: `${spacingTokens.sm} ${spacingTokens.md}`,
  borderBottom: `1px solid ${colorTokens.border.subtle}`,
};

const NAV_GROUP_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  border: `1px solid ${colorTokens.border.subtle}`,
  borderRadius: radiusTokens.sm,
  overflow: "hidden",
};

const FORM_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  padding: spacingTokens.md,
  display: "flex",
  flexDirection: "column",
  gap: spacingTokens.md,
};

const COLLECTION_LABEL_STYLE: CSSProperties = {
  fontSize: fontTokens.size.sm,
  color: colorTokens.text.tertiary,
};

const REQUIRED_HINT_STYLE: CSSProperties = {
  fontSize: fontTokens.size.xs,
  color: colorTokens.text.tertiary,
  marginInlineStart: "auto",
};

const HEADER_LABEL_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: spacingTokens.xs,
  color: colorTokens.text.secondary,
  fontSize: fontTokens.size.md,
  fontWeight: fontTokens.weight.medium,
};

const FIELD_HEADER_ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: spacingTokens.xs,
  width: "100%",
};

const HELPER_TEXT_STYLE: CSSProperties = {
  fontSize: fontTokens.size.sm,
  color: colorTokens.text.tertiary,
  fontFamily: '"Consolas", "Monaco", "Courier New", monospace',
};

const RICH_TEXT_STYLE: CSSProperties = {
  width: "100%",
  minHeight: 168,
  padding: spacingTokens.sm,
  background: colorTokens.background.tertiary,
  border: `1px solid ${colorTokens.border.subtle}`,
  borderRadius: radiusTokens.sm,
  resize: "vertical",
  fontFamily: "inherit",
  fontSize: fontTokens.size.md,
  color: colorTokens.text.primary,
  outline: "none",
};

function fieldHelperText(
  field: SiteCollectionField,
  value: SiteCollectionItemValue,
  collectionDisplayName: string,
  collection: SiteCollection,
): string | null {
  if (!isFieldUsedAsSelectorFilter(field, collection)) {
    return null;
  }
  if (value.text === null || value.text.trim() === "") {
    return null;
  }
  const slugged = collectionDisplayName.toLowerCase().replace(/\s+/g, "-");
  return `yoursite.url/${slugged}/${value.text}`;
}

function isFieldUsedAsSelectorFilter(field: SiteCollectionField, collection: SiteCollection): boolean {
  return collection.selectors.some((selector) =>
    selector.filters.some((filter) => filter.fieldId === field.id),
  );
}

function pickInputType(kind: SiteCollectionFieldKind): "text" | "number" {
  if (kind === "number") {
    return "number";
  }
  return "text";
}

function pickPlaceholder(kind: SiteCollectionFieldKind, displayName: string): string {
  if (kind === "date") {
    return "YYYY-MM-DD";
  }
  if (kind === "link") {
    return "url";
  }
  return displayName;
}

function FieldEditor({
  field,
  fieldDisplayName,
  value,
  onChange,
}: {
  readonly field: SiteCollectionField;
  readonly fieldDisplayName: string;
  readonly value: SiteCollectionItemValue;
  readonly onChange: (text: string) => void;
}) {
  if (field.kind === "rich-text") {
    return (
      <textarea
        style={RICH_TEXT_STYLE}
        value={value.text === null ? "" : value.text}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        aria-label={fieldDisplayName}
      />
    );
  }
  return (
    <Input
      type={pickInputType(field.kind)}
      value={value.text === null ? "" : value.text}
      onChange={(next) => onChange(typeof next === "number" ? String(next) : next)}
      placeholder={pickPlaceholder(field.kind, fieldDisplayName)}
      ariaLabel={fieldDisplayName}
    />
  );
}

function FieldEditorRow({
  field,
  fieldIndex,
  collection,
  item,
}: {
  readonly field: SiteCollectionField;
  readonly fieldIndex: number;
  readonly collection: SiteCollection;
  readonly item: SiteCollectionItem;
}) {
  const { setFieldValue } = useSiteCms();
  const value = findSiteCollectionItemValue(item, field.id);
  const collectionDisplayName = getSiteCollectionDisplayName(collection, 0);
  const fieldDisplayName = getSiteCollectionFieldDisplayName(field, fieldIndex);
  const helperText = fieldHelperText(field, value, collectionDisplayName, collection);
  const required = isFieldUsedAsSelectorFilter(field, collection);

  const handleChange = useCallback(
    (text: string) => {
      setFieldValue({ collectionId: collection.id, itemId: item.id, fieldId: field.id, text });
    },
    [collection.id, field.id, item.id, setFieldValue],
  );

  const labelNode = (
    <span style={FIELD_HEADER_ROW_STYLE}>
      <span style={HEADER_LABEL_STYLE}>
        <SiteCollectionFieldIcon kind={field.kind} />
        {fieldDisplayName}
      </span>
      {required && <span style={REQUIRED_HINT_STYLE}>Required</span>}
    </span>
  );

  return (
    <FieldGroup label="" style={{ gap: spacingTokens.xs }}>
      {labelNode}
      <FieldEditor
        field={field}
        fieldDisplayName={fieldDisplayName}
        value={value}
        onChange={handleChange}
      />
      {helperText && <span style={HELPER_TEXT_STYLE}>{helperText}</span>}
    </FieldGroup>
  );
}

/** Right-drawer editor for the active item. */
export function SiteCmsItemEditor() {
  const { activeCollection, activeItem, openItemRelative, closeItem } = useSiteCms();

  const handlePrevious = useCallback(() => {
    openItemRelative(-1);
  }, [openItemRelative]);
  const handleNext = useCallback(() => {
    openItemRelative(1);
  }, [openItemRelative]);

  if (!activeCollection || !activeItem) {
    return null;
  }

  const itemIndex = activeCollection.items.findIndex((item) => item.id === activeItem.id);
  const hasPrevious = itemIndex > 0;
  const hasNext = itemIndex >= 0 && itemIndex < activeCollection.items.length - 1;
  const itemDisplayName = getSiteCollectionItemDisplayName(activeItem);
  const collectionDisplayName = getSiteCollectionDisplayName(activeCollection, 0);

  return (
    <aside style={ROOT_STYLE} aria-label={`Editing ${itemDisplayName}`}>
      <div style={HEADER_STYLE}>
        <div style={NAV_GROUP_STYLE}>
          <IconButton
            icon={<ChevronUpIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />}
            ariaLabel="Previous item"
            variant="ghost"
            size="sm"
            onClick={handlePrevious}
            disabled={!hasPrevious}
            style={{ width: 28, height: 24, padding: 0, borderRadius: 0 }}
          />
          <IconButton
            icon={<ChevronDownIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />}
            ariaLabel="Next item"
            variant="ghost"
            size="sm"
            onClick={handleNext}
            disabled={!hasNext}
            style={{ width: 28, height: 24, padding: 0, borderRadius: 0 }}
          />
        </div>
        <IconButton
          icon={<CloseIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />}
          ariaLabel="Close item editor"
          variant="ghost"
          size="sm"
          onClick={closeItem}
          style={{ width: 24, height: 24, padding: 0 }}
        />
      </div>
      <div style={FORM_STYLE}>
        <span style={COLLECTION_LABEL_STYLE}>{collectionDisplayName}</span>
        {activeCollection.fields.map((field, fieldIndex) => (
          <FieldEditorRow
            key={field.id}
            field={field}
            fieldIndex={fieldIndex}
            collection={activeCollection}
            item={activeItem}
          />
        ))}
      </div>
    </aside>
  );
}
