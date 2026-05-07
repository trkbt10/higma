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
 * Component selection is implemented by locating the page that
 * contains the component node and switching to it before selecting.
 * The components map on a `FigDesignDocument` is page-agnostic, so
 * this lookup happens lazily on click rather than during render.
 */

import { useCallback, useMemo, useState } from "react";
import type {
  FigDesignDocument,
  FigDesignNode,
  FigNodeId,
  FigPage,
  FigPageId,
} from "@higma-document-models/fig/domain";
import { dfsById } from "@higma-primitives/tree";
import { nodeTypeGlyph, nodeTypeLabel } from "./node-icon";
import type { SelectionModifiers } from "../selection";

const DESIGN_NODE_DFS_OPTIONS = {
  getId: (node: FigDesignNode) => node.id as string,
  getChildren: (node: FigDesignNode): readonly FigDesignNode[] => node.children ?? [],
} as const;

type Props = {
  readonly document: FigDesignDocument;
  readonly activePage: FigPage | null;
  readonly activePageId: FigPageId | null;
  readonly onPageChange: (id: FigPageId) => void;
  readonly hoveredId: FigNodeId | null;
  readonly selectedIds: ReadonlySet<FigNodeId>;
  readonly primaryId: FigNodeId | null;
  readonly onHover: (id: FigNodeId | null) => void;
  readonly onSelect: (id: FigNodeId, modifiers: SelectionModifiers) => void;
  readonly onClearSelection: () => void;
};

type Section = "pages" | "layers" | "components";

function modifiersFromMouse(event: React.MouseEvent): SelectionModifiers {
  return {
    meta: event.metaKey || event.ctrlKey,
    shift: event.shiftKey,
  };
}

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
    return Array.from(props.document.components.values());
  }, [props.document]);

  const handleComponentClick = useCallback(
    (componentId: FigNodeId, modifiers: SelectionModifiers) => {
      const owner = findPageContaining(props.document, componentId);
      if (!owner) {
        return;
      }
      if (owner.id !== props.activePageId) {
        // Switching pages clears selection in the viewer; honour that
        // by sending an unmodified click so the new page starts with
        // the component as the lone selection.
        props.onPageChange(owner.id);
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
        title={`Pages (${props.document.pages.length})`}
        collapsed={collapsed.pages}
        onToggle={() => toggleSection("pages")}
      />
      {!collapsed.pages && (
        <ul className="higma-fig-tree higma-fig-tree--flat">
          {props.document.pages.map((page) => (
            <li key={page.id}>
              <button
                type="button"
                className="higma-fig-tree__row"
                aria-pressed={page.id === props.activePageId}
                onClick={() => props.onPageChange(page.id)}
              >
                <span className="higma-fig-tree__glyph" aria-hidden="true">
                  ▤
                </span>
                <span className="higma-fig-tree__label">{page.name}</span>
              </button>
            </li>
          ))}
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
          {props.activePage.children.map((child) => (
            <LayerNode
              key={child.id}
              node={child}
              depth={0}
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
            <li key={component.id}>
              <button
                type="button"
                className="higma-fig-tree__row"
                aria-pressed={props.selectedIds.has(component.id)}
                onClick={(event) => handleComponentClick(component.id, modifiersFromMouse(event))}
                onMouseEnter={() => props.onHover(component.id)}
                onMouseLeave={() => props.onHover(null)}
              >
                <span className="higma-fig-tree__glyph" aria-hidden="true">
                  {nodeTypeGlyph(component.type)}
                </span>
                <span className="higma-fig-tree__label" title={component.name}>
                  {component.name}
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
  readonly node: FigDesignNode;
  readonly depth: number;
  readonly hoveredId: FigNodeId | null;
  readonly selectedIds: ReadonlySet<FigNodeId>;
  readonly primaryId: FigNodeId | null;
  readonly onHover: (id: FigNodeId | null) => void;
  readonly onSelect: (id: FigNodeId, modifiers: SelectionModifiers) => void;
};

function LayerNode({
  node,
  depth,
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
  const hasChildren = !!node.children && node.children.length > 0;
  const isSelected = selectedIds.has(node.id);
  const isPrimary = primaryId === node.id;
  const isHovered = node.id === hoveredId && !isSelected;
  const labelTitle = `${node.name} (${nodeTypeLabel(node.type)})`;
  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpanded((prev) => !prev);
    },
    [],
  );
  const handleRowClick = useCallback(
    (event: React.MouseEvent) => {
      onSelect(node.id, modifiersFromMouse(event));
    },
    [node.id, onSelect],
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
        onMouseEnter={() => onHover(node.id)}
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
          {nodeTypeGlyph(node.type)}
        </span>
        <span className="higma-fig-tree__label" title={labelTitle}>
          {node.name || nodeTypeLabel(node.type)}
        </span>
      </button>
      {hasChildren && expanded && (
        <ul role="group">
          {node.children?.map((child) => (
            <LayerNode
              key={child.id}
              node={child}
              depth={depth + 1}
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

function formatLayersTitle(activePage: FigPage | null, selectionCount: number): string {
  if (!activePage) {return "Layers";}
  if (selectionCount > 1) {
    return `Layers — ${activePage.name} (${selectionCount} selected)`;
  }
  return `Layers — ${activePage.name}`;
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
  document: FigDesignDocument,
  nodeId: FigNodeId,
): FigPage | null {
  for (const page of document.pages) {
    if (dfsById(page.children, nodeId as string, DESIGN_NODE_DFS_OPTIONS) !== undefined) {
      return page;
    }
  }
  return null;
}
