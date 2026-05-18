/**
 * @file Layer panel
 *
 * Shows the layer tree for the active page.
 * Uses react-editor-ui's LayerItem component (SoT for layer item rendering)
 * for inline rename, visibility/lock toggles, drag-to-reorder, and
 * row context menus. This module only adapts those affordances to fig
 * reducer actions; it owns no row-presentation logic of its own.
 *
 * INSTANCE nodes and their children (inherited from SYMBOL) are highlighted
 * with Figma's purple accent color to visually distinguish inherited elements.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useFigEditor } from "../../context/FigEditorContext";
import type { FigDesignNode, FigNodeId } from "@higma-document-models/fig/domain";
import { isSelected } from "@higma-editor-kernel/core/selection";
import { OptionalPropertySection } from "@higma-editor-surfaces/controls/ui";
import { LayerItem } from "react-editor-ui/LayerItem";
import type { LayerContextMenuItem, DropPosition } from "react-editor-ui/LayerItem";
import {
  FrameIcon,
  RectIcon,
  EllipseIcon,
  TextBoxIcon,
  LineIcon,
  StarIcon,
  FolderIcon,
  DiamondIcon,
  UnknownShapeIcon,
} from "@higma-editor-kernel/ui/icons";
import { iconTokens, colorTokens, fontTokens, spacingTokens } from "@higma-editor-kernel/ui/design-tokens";
import { resolveLayerNodePresentation, type LayerNodeBadge } from "./layer-node-presentation";
import { allowsFigUserOperation, type FigUserOperationDomain } from "../../context/fig-editor/user-operation";
import { useFigOperationDomain } from "../../context/use-fig-operation-domain";

// =============================================================================
// Icon helpers
// =============================================================================

const ICON_PROPS = { size: iconTokens.size.sm, strokeWidth: iconTokens.strokeWidth };

function getNodeIcon(type: FigDesignNode["type"], color: string | undefined): ReactNode {
  const props = color ? { ...ICON_PROPS, color } : ICON_PROPS;

  switch (type) {
    case "FRAME":
      return <FrameIcon {...props} />;
    case "SYMBOL":
      return <RectIcon {...props} />;
    case "GROUP":
      return <FolderIcon {...props} />;
    case "TEXT":
      return <TextBoxIcon {...props} />;
    case "RECTANGLE":
    case "ROUNDED_RECTANGLE":
      return <RectIcon {...props} />;
    case "ELLIPSE":
      return <EllipseIcon {...props} />;
    case "VECTOR":
    case "LINE":
      return <LineIcon {...props} />;
    case "STAR":
      return <StarIcon {...props} />;
    case "INSTANCE":
      return <DiamondIcon {...props} />;
    default:
      return <UnknownShapeIcon {...props} />;
  }
}

// =============================================================================
// Layer badge
// =============================================================================

/**
 * Layer-row badge ("Frame" / "Component" / "Set" / "Inherited").
 *
 * Visual identity:
 * - Text: text.primary on white (17.4:1 AAA — operators always read
 *   the label legibly regardless of the type colour).
 * - Type colour: 2px LEFT-rail (inset border) instead of a 1px ring
 *   around the whole badge. The rail is structurally more visible at
 *   a glance — operators previously scanned the layer list by the
 *   row's badge tint, and a 1px border was too quiet to preserve that
 *   scanning affordance.
 * - White background keeps each badge clearly delimited from the
 *   layer row's hover/selected background tints.
 */
const layerBadgeBaseStyle: CSSProperties = {
  display: "inline-block",
  fontSize: "9px",
  lineHeight: "14px",
  padding: "0 4px 0 6px",
  borderRadius: "3px",
  fontWeight: 600,
  letterSpacing: "0.02em",
  color: "#1a1a1a",
  backgroundColor: "#ffffff",
};

function LayerBadge({ label, color }: LayerNodeBadge) {
  return (
    <span
      style={{
        ...layerBadgeBaseStyle,
        boxShadow: `inset 3px 0 0 0 ${color}, inset 0 0 0 1px ${color}33`,
      }}
    >
      {label}
    </span>
  );
}

// =============================================================================
// Expansion state context
// =============================================================================

type ExpansionState = {
  readonly expandedIds: ReadonlySet<string>;
  readonly toggle: (id: string) => void;
};

const ExpansionContext = createContext<ExpansionState>({
  expandedIds: new Set(),
  toggle: () => {},
});

function useExpansion(): ExpansionState {
  return useContext(ExpansionContext);
}

// =============================================================================
// Drag state context
// =============================================================================

type LayerDragState =
  | { readonly active: false }
  | {
      readonly active: true;
      readonly draggingId: FigNodeId;
      readonly overId: FigNodeId | undefined;
      readonly overPosition: DropPosition;
    };

type DragController = {
  readonly state: LayerDragState;
  readonly startDrag: (event: ReactDragEvent<HTMLDivElement>, nodeId: FigNodeId) => void;
  readonly trackOver: (event: ReactDragEvent<HTMLDivElement>, nodeId: FigNodeId) => void;
  readonly clearOver: () => void;
  readonly drop: (event: ReactDragEvent<HTMLDivElement>, targetId: FigNodeId) => void;
  readonly endDrag: () => void;
};

const IDLE_DRAG: LayerDragState = { active: false };

const DragContext = createContext<DragController>({
  state: IDLE_DRAG,
  startDrag: () => {},
  trackOver: () => {},
  clearOver: () => {},
  drop: () => {},
  endDrag: () => {},
});

function useLayerDrag(): DragController {
  return useContext(DragContext);
}

// =============================================================================
// Context menu actions
// =============================================================================

const LAYER_MENU_ACTIONS = {
  rename: "rename",
  duplicate: "duplicate",
  delete: "delete",
  bringForward: "bring-forward",
  sendBackward: "send-backward",
  bringToFront: "bring-to-front",
  sendToBack: "send-to-back",
} as const;

type LayerMenuActionId = (typeof LAYER_MENU_ACTIONS)[keyof typeof LAYER_MENU_ACTIONS];

function isLayerMenuActionId(value: string): value is LayerMenuActionId {
  return Object.values<string>(LAYER_MENU_ACTIONS).includes(value);
}

function buildLayerMenuItems({
  canRename,
  canMutate,
  canReorder,
}: {
  readonly canRename: boolean;
  readonly canMutate: boolean;
  readonly canReorder: boolean;
}): readonly LayerContextMenuItem[] {
  return [
    { id: LAYER_MENU_ACTIONS.rename, label: "Rename", shortcut: "F2", disabled: !canRename },
    { id: LAYER_MENU_ACTIONS.duplicate, label: "Duplicate", disabled: !canMutate },
    { id: LAYER_MENU_ACTIONS.delete, label: "Delete", danger: true, disabled: !canMutate },
    { id: "sep-1", label: "", divider: true },
    { id: LAYER_MENU_ACTIONS.bringForward, label: "Bring forward", disabled: !canReorder },
    { id: LAYER_MENU_ACTIONS.sendBackward, label: "Send backward", disabled: !canReorder },
    { id: LAYER_MENU_ACTIONS.bringToFront, label: "Bring to front", disabled: !canReorder },
    { id: LAYER_MENU_ACTIONS.sendToBack, label: "Send to back", disabled: !canReorder },
  ];
}

// =============================================================================
// Recursive layer tree
// =============================================================================

type LayerTreeProps = {
  readonly nodes: readonly FigDesignNode[];
  readonly depth: number;
  readonly operationDomain: FigUserOperationDomain;
  readonly isInstanceContext: boolean;
};

function computeDropPositionFromEvent(
  event: ReactDragEvent<HTMLDivElement>,
): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  const offset = event.clientY - rect.top;
  if (offset < rect.height / 2) {
    return "before";
  }
  return "after";
}

function LayerTree({ nodes, depth, operationDomain, isInstanceContext }: LayerTreeProps) {
  const { nodeSelection, dispatch } = useFigEditor();
  const { expandedIds, toggle } = useExpansion();
  const dragController = useLayerDrag();
  const canSelectNode = allowsFigUserOperation(operationDomain, "select-node");
  const canRenameNode = allowsFigUserOperation(operationDomain, "update-property");
  const canDelete = allowsFigUserOperation(operationDomain, "delete-selection");
  const canDuplicate = allowsFigUserOperation(operationDomain, "duplicate-selection");
  const canReorder = allowsFigUserOperation(operationDomain, "reorder-node");

  const handlePointerDown = useCallback(
    (nodeId: FigNodeId) => (e: ReactPointerEvent) => {
      if (!canSelectNode) {
        return;
      }
      const addToSelection = e.shiftKey || e.metaKey || e.ctrlKey;
      dispatch({
        type: "SELECT_NODE",
        nodeId,
        addToSelection,
      });
    },
    [canSelectNode, dispatch],
  );

  const handleRename = useCallback(
    (nodeId: FigNodeId) => (next: string) => {
      if (!canRenameNode) {
        return;
      }
      dispatch({ type: "RENAME_NODE", nodeId, name: next, source: "layer-panel" });
    },
    [canRenameNode, dispatch],
  );

  const handleVisibilityChange = useCallback(
    (nodeId: FigNodeId) => (nextVisible: boolean) => {
      dispatch({
        type: "UPDATE_NODE",
        nodeId,
        updater: (node) => ({ ...node, visible: nextVisible }),
        source: "layer-panel",
      });
    },
    [dispatch],
  );

  const handleLockChange = useCallback(
    (nodeId: FigNodeId) => (nextLocked: boolean) => {
      dispatch({
        type: "UPDATE_NODE",
        nodeId,
        updater: (node) => ({ ...node, locked: nextLocked }),
        source: "layer-panel",
      });
    },
    [dispatch],
  );

  const handleContextMenu = useCallback(
    (nodeId: FigNodeId) => (itemId: string) => {
      if (!isLayerMenuActionId(itemId)) {
        return;
      }
      switch (itemId) {
        case LAYER_MENU_ACTIONS.rename:
          // Rename via the menu is initiated by a synthetic double-tap on
          // the row; LayerItem owns the editing state internally and we
          // cannot programmatically open it. Selecting the row first lets
          // the user follow up with F2/double-click consistently with
          // the rest of the editor.
          dispatch({ type: "SELECT_NODE", nodeId, addToSelection: false });
          return;
        case LAYER_MENU_ACTIONS.duplicate:
          dispatch({ type: "DUPLICATE_NODES", nodeIds: [nodeId] });
          return;
        case LAYER_MENU_ACTIONS.delete:
          dispatch({ type: "DELETE_NODES", nodeIds: [nodeId] });
          return;
        case LAYER_MENU_ACTIONS.bringForward:
          dispatch({ type: "REORDER_NODE", nodeId, direction: "forward" });
          return;
        case LAYER_MENU_ACTIONS.sendBackward:
          dispatch({ type: "REORDER_NODE", nodeId, direction: "backward" });
          return;
        case LAYER_MENU_ACTIONS.bringToFront:
          dispatch({ type: "REORDER_NODE", nodeId, direction: "front" });
          return;
        case LAYER_MENU_ACTIONS.sendToBack:
          dispatch({ type: "REORDER_NODE", nodeId, direction: "back" });
      }
    },
    [dispatch],
  );

  const menuItems = useMemo(
    () =>
      buildLayerMenuItems({
        canRename: canRenameNode,
        canMutate: canDelete && canDuplicate,
        canReorder,
      }),
    [canDelete, canDuplicate, canRenameNode, canReorder],
  );

  const reversedNodes = useMemo(() => [...nodes].reverse(), [nodes]);

  return (
    <>
      {reversedNodes.map((node) => {
        const selected = isSelected(nodeSelection, node.id);
        const hasChildren = node.children != null && node.children.length > 0;
        const expanded = expandedIds.has(node.id);
        const isInstance = node.type === "INSTANCE";
        const childIsInstanceContext = isInstanceContext || isInstance;
        const presentation = resolveLayerNodePresentation(node.type, isInstanceContext);
        const badge = presentation.badge ? <LayerBadge {...presentation.badge} /> : undefined;

        const dragState = dragController.state;
        const isDragging = dragState.active && dragState.draggingId === node.id;
        const isDropTarget =
          dragState.active && dragState.overId === node.id && dragState.draggingId !== node.id;
        const dropPosition: DropPosition = isDropTarget ? dragState.overPosition : null;

        return (
          <div
            key={node.id}
            style={{ ...presentation.rowStyle, opacity: isDragging ? 0.4 : undefined }}
          >
            <LayerItem
              id={node.id}
              label={node.name}
              icon={getNodeIcon(node.type, presentation.iconColor)}
              depth={depth}
              selected={selected}
              dimmed={!node.visible}
              visible={node.visible}
              locked={node.locked ?? false}
              hasChildren={hasChildren}
              expanded={expanded}
              onToggle={hasChildren ? () => toggle(node.id) : undefined}
              onPointerDown={canSelectNode ? handlePointerDown(node.id) : undefined}
              renamable={canRenameNode}
              onRename={handleRename(node.id)}
              onVisibilityChange={handleVisibilityChange(node.id)}
              onLockChange={handleLockChange(node.id)}
              showVisibilityToggle
              showLockToggle
              draggable={canReorder}
              onDragStart={(event) => dragController.startDrag(event, node.id)}
              onDragOver={(event) => dragController.trackOver(event, node.id)}
              onDragLeave={() => dragController.clearOver()}
              onDrop={(event) => dragController.drop(event, node.id)}
              onDragEnd={() => dragController.endDrag()}
              dropPosition={dropPosition}
              contextMenuItems={[...menuItems]}
              onContextMenu={handleContextMenu(node.id)}
              badge={badge}
            />
            {hasChildren && expanded && (
              <LayerTree
                nodes={node.children!}
                depth={depth + 1}
                operationDomain={operationDomain}
                isInstanceContext={childIsInstanceContext}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function buildLayerContent({
  children,
  expandedIds,
  toggleExpand,
  operationDomain,
}: {
  readonly children: readonly FigDesignNode[];
  readonly expandedIds: ReadonlySet<string>;
  readonly toggleExpand: (id: string) => void;
  readonly operationDomain: FigUserOperationDomain;
}): ReactNode {
  if (children.length === 0) {
    return (
      <div
        style={{
          padding: `${spacingTokens.xl} ${spacingTokens.lg}`,
          textAlign: "center",
          color: colorTokens.text.tertiary,
          fontSize: fontTokens.size.lg,
        }}
      >
        Empty page
      </div>
    );
  }
  return (
    <ExpansionContext.Provider value={{ expandedIds, toggle: toggleExpand }}>
      <div role="tree" aria-label="Layers">
        <LayerTree nodes={children} depth={0} operationDomain={operationDomain} isInstanceContext={false} />
      </div>
    </ExpansionContext.Provider>
  );
}

// =============================================================================
// Component
// =============================================================================

const DRAG_MIME_TYPE = "application/x-fig-layer-id";

/**
 * Layer tree panel for the fig editor.
 *
 * Expansion and drag state are managed here via React contexts so that
 * recursive LayerTree components share a single stable state store.
 */
export function LayerPanel() {
  const { activePage, dispatch } = useFigEditor();
  const operationDomain = useFigOperationDomain();
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [dragState, setDragState] = useState<LayerDragState>(IDLE_DRAG);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const startDrag = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, nodeId: FigNodeId) => {
      event.dataTransfer.setData(DRAG_MIME_TYPE, nodeId);
      event.dataTransfer.effectAllowed = "move";
      setDragState({ active: true, draggingId: nodeId, overId: undefined, overPosition: null });
    },
    [],
  );

  const trackOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, nodeId: FigNodeId) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const overPosition = computeDropPositionFromEvent(event);
      setDragState((prev) => {
        if (!prev.active || prev.draggingId === nodeId) {
          return prev;
        }
        if (prev.overId === nodeId && prev.overPosition === overPosition) {
          return prev;
        }
        return { active: true, draggingId: prev.draggingId, overId: nodeId, overPosition };
      });
    },
    [],
  );

  const clearOver = useCallback(() => {
    setDragState((prev) => {
      if (!prev.active || prev.overId === undefined) {
        return prev;
      }
      return { active: true, draggingId: prev.draggingId, overId: undefined, overPosition: null };
    });
  }, []);

  const drop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, targetId: FigNodeId) => {
      event.preventDefault();
      const sourceId = (event.dataTransfer.getData(DRAG_MIME_TYPE) as FigNodeId) || undefined;
      const position = computeDropPositionFromEvent(event);
      if (sourceId && sourceId !== targetId) {
        dispatch({
          type: "MOVE_NODE_RELATIVE",
          nodeId: sourceId,
          targetId,
          position: position === "after" ? "after" : "before",
        });
      }
      setDragState(IDLE_DRAG);
    },
    [dispatch],
  );

  const endDrag = useCallback(() => {
    setDragState(IDLE_DRAG);
  }, []);

  const dragController = useMemo<DragController>(
    () => ({ state: dragState, startDrag, trackOver, clearOver, drop, endDrag }),
    [clearOver, drop, endDrag, dragState, startDrag, trackOver],
  );

  if (!activePage) {
    return (
      <OptionalPropertySection title="Layers" badge={0} defaultExpanded>
        <div
          style={{
            padding: `${spacingTokens.xl} ${spacingTokens.lg}`,
            textAlign: "center",
            color: colorTokens.text.tertiary,
            fontSize: fontTokens.size.lg,
          }}
        >
          No page selected
        </div>
      </OptionalPropertySection>
    );
  }

  const layerContent = buildLayerContent({
    children: activePage.children,
    expandedIds,
    toggleExpand,
    operationDomain,
  });

  return (
    <OptionalPropertySection title="Layers" badge={activePage.children.length} defaultExpanded>
      <DragContext.Provider value={dragController}>{layerContent}</DragContext.Provider>
    </OptionalPropertySection>
  );
}
