/**
 * @file Left sidebar: pages list, layers tree for the active page,
 * components list.
 *
 * The layers tree mirrors VS Code's tree view conventions: indent per
 * depth, an expand chevron on rows that have children, and selection
 * the inspect panel listens to. Hover and selection state are owned by
 * the parent so the canvas overlay and this tree stay in sync.
 *
 * Selection is multi-pick:
 *   - Plain click selects exactly the row.
 *   - Cmd/Ctrl-click toggles the row in/out of the set without
 *     touching other members.
 *   - Shift-click selects every row between the current primary and
 *     the click target in painter (DFS pre-order) order.
 *   - The "primary" row paints a stronger highlight so subsequent
 *     shift-clicks have a visible anchor.
 *
 * Component selection is implemented by locating the Kiwi CANVAS root
 * that contains the SYMBOL node and switching to it before selecting.
 */

import { useCallback, useMemo, useState } from "react";
import { getNodeType, guidToString, type FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import { FIG_NODE_TYPE, type FigNode } from "@higma-document-models/fig/types";
import { nodeTypeGlyph, nodeTypeLabel } from "./node-icon";
import type { SelectionModifiers } from "../selection";

type Props = {
  readonly document: FigKiwiDocumentIndex;
  readonly pages: readonly FigNode[];
  readonly activePage: FigNode | null;
  readonly activePageId: string | null;
  readonly onPageChange: (id: string) => void;
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
  readonly hoveredId: string | null;
  readonly selectedIds: ReadonlySet<string>;
  readonly primaryId: string | null;
  readonly onHover: (id: string | null) => void;
  readonly onSelect: (id: string, modifiers: SelectionModifiers) => void;
  readonly onClearSelection: () => void;
};

type Section = "pages" | "layers" | "components";

function modifiersFromMouse(event: React.MouseEvent): SelectionModifiers {
  return {
    meta: event.metaKey || event.ctrlKey,
    shift: event.shiftKey,
  };
}

/** Render pages, active-page layers, and SYMBOL nodes from the Kiwi document. */
export function LayersPanel(props: Props) {
  const [collapsed, setCollapsed] = useState<Record<Section, boolean>>({
    pages: false,
    layers: false,
    components: true,
  });
  const toggleSection = useCallback((section: Section) => {
    setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const components = useMemo(() => {
    return props.document.nodeChanges.filter((node) => getNodeType(node) === FIG_NODE_TYPE.SYMBOL);
  }, [props.document]);

  const handleComponentClick = useCallback(
    (componentId: string, modifiers: SelectionModifiers) => {
      const owner = findPageContaining(props.document, props.pages, componentId);
      if (!owner) {
        return;
      }
      const ownerId = guidToString(owner.guid);
      if (ownerId !== props.activePageId) {
        // Switching pages clears selection in the viewer; honour that
        // by sending an unmodified click so the new page starts with
        // the component as the lone selection.
        props.onPageChange(ownerId);
        props.onSelect(componentId, { meta: false, shift: false });
        return;
      }
      props.onSelect(componentId, modifiers);
    },
    [props],
  );

  const selectionCount = props.selectedIds.size;
  const layersTitle = formatLayersTitle(props.activePage, selectionCount);
  const layersAction = buildLayersAction(selectionCount, props.onClearSelection);

  return (
    <aside className="higma-fig-sidebar higma-fig-sidebar--left" aria-label="Layers">
      <SectionHeader
        title={`Pages (${props.pages.length})`}
        collapsed={collapsed.pages}
        onToggle={() => toggleSection("pages")}
      />
      {!collapsed.pages && (
        <ul className="higma-fig-tree higma-fig-tree--flat">
          {props.pages.map((page) => {
            const pageId = guidToString(page.guid);
            return (
              <li key={pageId}>
                <button
                  type="button"
                  className="higma-fig-tree__row"
                  aria-pressed={pageId === props.activePageId}
                  onClick={() => props.onPageChange(pageId)}
                >
                  <span className="higma-fig-tree__glyph" aria-hidden="true">
                    ▤
                  </span>
                  <span className="higma-fig-tree__label">{page.name ?? "Page"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <SectionHeader
        title={layersTitle}
        collapsed={collapsed.layers}
        onToggle={() => toggleSection("layers")}
        action={layersAction}
      />
      {!collapsed.layers && props.activePage && (
        <ul className="higma-fig-tree" role="tree">
          {props.childrenOf(props.activePage).map((child) => (
            <LayerNode
              key={guidToString(child.guid)}
              node={child}
              depth={0}
              childrenOf={props.childrenOf}
              hoveredId={props.hoveredId}
              selectedIds={props.selectedIds}
              primaryId={props.primaryId}
              onHover={props.onHover}
              onSelect={props.onSelect}
            />
          ))}
        </ul>
      )}

      <SectionHeader
        title={`Components (${components.length})`}
        collapsed={collapsed.components}
        onToggle={() => toggleSection("components")}
      />
      {!collapsed.components && (
        <ul className="higma-fig-tree higma-fig-tree--flat">
          {components.length === 0 && (
            <li className="higma-fig-tree__empty">No components defined.</li>
          )}
          {components.map((component) => (
            <li key={guidToString(component.guid)}>
              <button
                type="button"
                className="higma-fig-tree__row"
                aria-pressed={props.selectedIds.has(guidToString(component.guid))}
                onClick={(event) => handleComponentClick(guidToString(component.guid), modifiersFromMouse(event))}
                onMouseEnter={() => props.onHover(guidToString(component.guid))}
                onMouseLeave={() => props.onHover(null)}
              >
                <span className="higma-fig-tree__glyph" aria-hidden="true">
                  {nodeTypeGlyph(getNodeType(component))}
                </span>
                <span className="higma-fig-tree__label" title={component.name}>
                  {component.name ?? nodeTypeLabel(getNodeType(component))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

type SectionHeaderProps = {
  readonly title: string;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly action?: { readonly label: string; readonly onClick: () => void } | null;
};

function SectionHeader({ title, collapsed, onToggle, action }: SectionHeaderProps) {
  return (
    <div className="higma-fig-sidebar__section-row">
      <button
        type="button"
        className="higma-fig-sidebar__section"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span className="higma-fig-sidebar__chevron" aria-hidden="true">
          {collapsed ? "▸" : "▾"}
        </span>
        <span className="higma-fig-sidebar__section-title">{title}</span>
      </button>
      {action && (
        <button
          type="button"
          className="higma-fig-sidebar__section-action"
          // stopPropagation so the click does not also toggle the
          // surrounding section header's collapsed state.
          onClick={(event) => {
            event.stopPropagation();
            action.onClick();
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

type LayerNodeProps = {
  readonly node: FigNode;
  readonly depth: number;
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
  readonly hoveredId: string | null;
  readonly selectedIds: ReadonlySet<string>;
  readonly primaryId: string | null;
  readonly onHover: (id: string | null) => void;
  readonly onSelect: (id: string, modifiers: SelectionModifiers) => void;
};

function LayerNode({
  node,
  depth,
  childrenOf,
  hoveredId,
  selectedIds,
  primaryId,
  onHover,
  onSelect,
}: LayerNodeProps) {
  // Auto-collapse beyond the first level. Users can drill in
  // explicitly; auto-expanding the entire tree on a real-world Figma
  // export produces hundreds of rows on first paint.
  const [expanded, setExpanded] = useState<boolean>(depth < 1);
  const children = childrenOf(node);
  const id = guidToString(node.guid);
  const type = getNodeType(node);
  const hasChildren = children.length > 0;
  const isSelected = selectedIds.has(id);
  const isPrimary = primaryId === id;
  const isHovered = id === hoveredId && !isSelected;
  const label = node.name ?? nodeTypeLabel(type);
  const labelTitle = `${label} (${nodeTypeLabel(type)})`;
  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpanded((prev) => !prev);
    },
    [],
  );
  const handleRowClick = useCallback(
    (event: React.MouseEvent) => {
      onSelect(id, modifiersFromMouse(event));
    },
    [id, onSelect],
  );

  return (
    <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <button
        type="button"
        className="higma-fig-tree__row"
        style={{ paddingLeft: 8 + depth * 12 }}
        aria-pressed={isSelected}
        data-primary={isPrimary ? "true" : undefined}
        data-hovered={isHovered ? "true" : undefined}
        onClick={handleRowClick}
        onMouseEnter={() => onHover(id)}
        onMouseLeave={() => onHover(null)}
      >
        <span className="higma-fig-tree__chevron" aria-hidden="true">
          {hasChildren && (
            <span
              role="presentation"
              className="higma-fig-tree__chevron-glyph"
              onClick={handleToggle}
            >
              {expanded ? "▾" : "▸"}
            </span>
          )}
        </span>
        <span className="higma-fig-tree__glyph" aria-hidden="true">
          {nodeTypeGlyph(type)}
        </span>
        <span className="higma-fig-tree__label" title={labelTitle}>
          {label}
        </span>
      </button>
      {hasChildren && expanded && (
        <ul role="group">
          {children.map((child) => (
            <LayerNode
              key={guidToString(child.guid)}
              node={child}
              depth={depth + 1}
              childrenOf={childrenOf}
              hoveredId={hoveredId}
              selectedIds={selectedIds}
              primaryId={primaryId}
              onHover={onHover}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function formatLayersTitle(activePage: FigNode | null, selectionCount: number): string {
  if (!activePage) {return "Layers";}
  if (selectionCount > 1) {
    return `Layers — ${activePage.name ?? "Page"} (${selectionCount} selected)`;
  }
  return `Layers — ${activePage.name ?? "Page"}`;
}

// Right-side action slot: clear selection when something is selected
// — saves users digging for the canvas to deselect.
function buildLayersAction(
  selectionCount: number,
  onClearSelection: () => void,
): { readonly label: string; readonly onClick: () => void } | null {
  if (selectionCount === 0) {return null;}
  return { label: "Clear", onClick: onClearSelection };
}

function findPageContaining(
  document: FigKiwiDocumentIndex,
  pages: readonly FigNode[],
  nodeId: string,
): FigNode | null {
  const pageIds = new Set(pages.map((page) => guidToString(page.guid)));
  return findAncestorPage(document, pageIds, nodeId);
}

function findAncestorPage(
  document: FigKiwiDocumentIndex,
  pageIds: ReadonlySet<string>,
  nodeId: string,
): FigNode | null {
  const node = document.nodesByGuid.get(nodeId);
  if (node === undefined) {
    return null;
  }
  if (pageIds.has(nodeId)) {
    return node;
  }
  const parentGuid = node.parentIndex?.guid;
  if (parentGuid === undefined) {
    return null;
  }
  return findAncestorPage(document, pageIds, guidToString(parentGuid));
}
