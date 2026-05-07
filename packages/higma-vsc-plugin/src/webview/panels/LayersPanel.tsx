/**
 * @file Left sidebar: pages list, layers tree for the active page,
 * components list.
 *
 * The layers tree mirrors VS Code's tree view conventions: indent per
 * depth, an expand chevron on rows that have children, and a single
 * focusable selection that the inspect panel listens to. Hover and
 * selection state are owned by the parent so the canvas overlay and
 * this tree stay in sync.
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
  readonly selectedId: FigNodeId | null;
  readonly onHover: (id: FigNodeId | null) => void;
  readonly onSelect: (id: FigNodeId | null) => void;
};

type Section = "pages" | "layers" | "components";






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
    (componentId: FigNodeId) => {
      const owner = findPageContaining(props.document, componentId);
      if (!owner) {
        return;
      }
      if (owner.id !== props.activePageId) {
        props.onPageChange(owner.id);
      }
      props.onSelect(componentId);
    },
    [props],
  );

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
        title={props.activePage ? `Layers — ${props.activePage.name}` : "Layers"}
        collapsed={collapsed.layers}
        onToggle={() => toggleSection("layers")}
      />
      {!collapsed.layers && props.activePage && (
        <ul className="higma-fig-tree" role="tree">
          {props.activePage.children.map((child) => (
            <LayerNode
              key={child.id}
              node={child}
              depth={0}
              hoveredId={props.hoveredId}
              selectedId={props.selectedId}
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
                aria-pressed={component.id === props.selectedId}
                onClick={() => handleComponentClick(component.id)}
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
};

function SectionHeader({ title, collapsed, onToggle }: SectionHeaderProps) {
  return (
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
  );
}

type LayerNodeProps = {
  readonly node: FigDesignNode;
  readonly depth: number;
  readonly hoveredId: FigNodeId | null;
  readonly selectedId: FigNodeId | null;
  readonly onHover: (id: FigNodeId | null) => void;
  readonly onSelect: (id: FigNodeId | null) => void;
};

function LayerNode({ node, depth, hoveredId, selectedId, onHover, onSelect }: LayerNodeProps) {
  // Auto-collapse beyond the first level. Users can drill in
  // explicitly; auto-expanding the entire tree on a real-world Figma
  // export produces hundreds of rows on first paint.
  const [expanded, setExpanded] = useState<boolean>(depth < 1);
  const hasChildren = !!node.children && node.children.length > 0;
  const isSelected = node.id === selectedId;
  const isHovered = node.id === hoveredId && !isSelected;
  const labelTitle = `${node.name} (${nodeTypeLabel(node.type)})`;
  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpanded((prev) => !prev);
    },
    [],
  );

  return (
    <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <button
        type="button"
        className="higma-fig-tree__row"
        style={{ paddingLeft: 8 + depth * 12 }}
        aria-pressed={isSelected}
        data-hovered={isHovered ? "true" : undefined}
        onClick={() => onSelect(node.id)}
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
              selectedId={selectedId}
              onHover={onHover}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
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
