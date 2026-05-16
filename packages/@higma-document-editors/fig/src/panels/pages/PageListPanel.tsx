/**
 * @file Page list panel
 *
 * Left panel showing the list of pages with select / rename / reorder / delete
 * affordances. The row presentation, inline rename, context menu, and drag
 * preview all come from the kernel UI primitives; this component only adapts
 * those primitives to Fig page reducer actions.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { OptionalPropertySection } from "@higma-editor-surfaces/controls/ui";
import {
  AddItemButton,
  ContextMenu,
  InlineRenameInput,
  type InlineRenameInputHandle,
  type MenuEntry,
} from "@higma-editor-kernel/ui";
import { colorTokens, fontTokens, spacingTokens, radiusTokens } from "@higma-editor-kernel/ui/design-tokens";
import type { FigPageId } from "@higma-document-models/fig/domain";
import { useFigEditor } from "../../context/FigEditorContext";
import { allowsFigUserOperation } from "../../context/fig-editor/user-operation";
import { useFigOperationDomain } from "../../context/use-fig-operation-domain";

// =============================================================================
// Local state types
// =============================================================================

type PageContextMenuState =
  | { readonly open: false }
  | { readonly open: true; readonly pageId: FigPageId; readonly x: number; readonly y: number };

type DropPosition = "before" | "after";

type DragState =
  | { readonly active: false }
  | {
      readonly active: true;
      readonly draggingId: FigPageId;
      readonly originY: number;
      readonly overId: FigPageId | undefined;
      readonly overPosition: DropPosition;
    };

const CLOSED_MENU: PageContextMenuState = { open: false };
const IDLE_DRAG: DragState = { active: false };

// Distance the pointer must travel before a row click is reinterpreted as a drag.
const DRAG_ACTIVATION_THRESHOLD_PX = 4;

// =============================================================================
// Action ids exchanged with the kernel ContextMenu
// =============================================================================

const PAGE_MENU_ACTIONS = {
  rename: "rename",
  moveUp: "move-up",
  moveDown: "move-down",
  delete: "delete",
} as const;

type PageMenuActionId = (typeof PAGE_MENU_ACTIONS)[keyof typeof PAGE_MENU_ACTIONS];

function isPageMenuActionId(value: string): value is PageMenuActionId {
  return (
    value === PAGE_MENU_ACTIONS.rename ||
    value === PAGE_MENU_ACTIONS.moveUp ||
    value === PAGE_MENU_ACTIONS.moveDown ||
    value === PAGE_MENU_ACTIONS.delete
  );
}

// =============================================================================
// Styles
// =============================================================================

type RowVisualState = {
  readonly active: boolean;
  readonly dropBefore: boolean;
  readonly dropAfter: boolean;
  readonly dragging: boolean;
};

function dropIndicatorShadow({ dropBefore, dropAfter }: RowVisualState): string | undefined {
  if (dropBefore) {
    return `inset 0 2px 0 0 ${colorTokens.selection.primary}`;
  }
  if (dropAfter) {
    return `inset 0 -2px 0 0 ${colorTokens.selection.primary}`;
  }
  return undefined;
}

function pageRowBackground(active: boolean): string {
  return active ? `var(--selection-primary, ${colorTokens.selection.primary})` : "transparent";
}

function pageRowColor(active: boolean): string {
  return active ? "#ffffff" : `var(--text-primary, ${colorTokens.text.primary})`;
}

function pageRowStyle(state: RowVisualState): CSSProperties {
  const { active, dragging } = state;
  return {
    position: "relative",
    padding: `${spacingTokens.xs} ${spacingTokens.sm}`,
    fontSize: fontTokens.size.md,
    borderRadius: radiusTokens.sm,
    backgroundColor: pageRowBackground(active),
    color: pageRowColor(active),
    transition: "background-color 150ms ease",
    border: 0,
    textAlign: "left",
    cursor: dragging ? "grabbing" : "pointer",
    opacity: dragging ? 0.6 : 1,
    boxShadow: dropIndicatorShadow(state),
    userSelect: "none",
  };
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: spacingTokens["2xs"],
};

const displayLabelStyle: CSSProperties = {
  display: "inline-block",
  width: "100%",
};

// =============================================================================
// Component
// =============================================================================

/**
 * Page list panel for the fig editor.
 */
export function PageListPanel() {
  const { document, activePageId, dispatch } = useFigEditor();
  const operationDomain = useFigOperationDomain();
  const canEditPage = allowsFigUserOperation(operationDomain, "edit-page");

  const [menu, setMenu] = useState<PageContextMenuState>(CLOSED_MENU);
  const [drag, setDrag] = useState<DragState>(IDLE_DRAG);

  const renameHandlesRef = useRef<Map<FigPageId, InlineRenameInputHandle | null>>(new Map());

  const pages = document.pages;
  const pageCount = pages.length;

  const indexById = useMemo(() => {
    const result = new Map<FigPageId, number>();
    pages.forEach((page, index) => {
      result.set(page.id, index);
    });
    return result;
  }, [pages]);

  const closeMenu = useCallback(() => setMenu(CLOSED_MENU), []);

  const handleAddPage = useCallback(() => {
    if (!canEditPage) {
      return;
    }
    dispatch({ type: "ADD_PAGE", name: `Page ${pageCount + 1}` });
  }, [canEditPage, dispatch, pageCount]);

  const handleSelectPage = useCallback(
    (pageId: FigPageId) => {
      if (!canEditPage) {
        return;
      }
      dispatch({ type: "SELECT_PAGE", pageId });
    },
    [canEditPage, dispatch],
  );

  const handleRenameCommit = useCallback(
    (pageId: FigPageId, name: string) => {
      if (!canEditPage) {
        return;
      }
      dispatch({ type: "RENAME_PAGE", pageId, name });
    },
    [canEditPage, dispatch],
  );

  const movePage = useCallback(
    (pageId: FigPageId, toIndex: number) => {
      if (!canEditPage) {
        return;
      }
      dispatch({ type: "MOVE_PAGE", pageId, toIndex });
    },
    [canEditPage, dispatch],
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, pageId: FigPageId) => {
      if (!canEditPage) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setMenu({ open: true, pageId, x: event.clientX, y: event.clientY });
    },
    [canEditPage],
  );

  const handleMenuAction = useCallback(
    (actionId: string) => {
      if (!menu.open || !isPageMenuActionId(actionId)) {
        return;
      }
      const targetId = menu.pageId;
      const currentIndex = indexById.get(targetId);
      if (currentIndex === undefined) {
        return;
      }
      if (actionId === PAGE_MENU_ACTIONS.rename) {
        renameHandlesRef.current.get(targetId)?.requestRename();
        return;
      }
      if (actionId === PAGE_MENU_ACTIONS.moveUp && currentIndex > 0) {
        movePage(targetId, currentIndex - 1);
        return;
      }
      if (actionId === PAGE_MENU_ACTIONS.moveDown && currentIndex < pageCount - 1) {
        movePage(targetId, currentIndex + 1);
        return;
      }
      if (actionId === PAGE_MENU_ACTIONS.delete && pageCount > 1) {
        dispatch({ type: "DELETE_PAGE", pageId: targetId });
      }
    },
    [dispatch, indexById, menu, movePage, pageCount],
  );

  const menuItems = useMemo<readonly MenuEntry[]>(() => {
    if (!menu.open) {
      return [];
    }
    const currentIndex = indexById.get(menu.pageId) ?? 0;
    const canMoveUp = currentIndex > 0;
    const canMoveDown = currentIndex < pageCount - 1;
    const canDelete = pageCount > 1;
    return [
      { id: PAGE_MENU_ACTIONS.rename, label: "Rename", shortcut: "F2" },
      { type: "separator" },
      { id: PAGE_MENU_ACTIONS.moveUp, label: "Move up", disabled: !canMoveUp },
      { id: PAGE_MENU_ACTIONS.moveDown, label: "Move down", disabled: !canMoveDown },
      { type: "separator" },
      { id: PAGE_MENU_ACTIONS.delete, label: "Delete", danger: true, disabled: !canDelete },
    ];
  }, [indexById, menu, pageCount]);

  // -------------------------------------------------------------------------
  // Drag-to-reorder via pointer events on rows.
  // -------------------------------------------------------------------------

  const computeDropTarget = useCallback(
    (clientY: number): { overId: FigPageId | undefined; overPosition: DropPosition } => {
      const rows = window.document.querySelectorAll<HTMLDivElement>("[data-page-row-id]");
      const matched = Array.from(rows).find((row) => {
        const rect = row.getBoundingClientRect();
        return clientY >= rect.top && clientY <= rect.bottom;
      });
      if (!matched) {
        return { overId: undefined, overPosition: "after" };
      }
      const rect = matched.getBoundingClientRect();
      const position: DropPosition = clientY < rect.top + rect.height / 2 ? "before" : "after";
      const overId = matched.getAttribute("data-page-row-id") as FigPageId | null;
      return { overId: overId ?? undefined, overPosition: position };
    },
    [],
  );

  const handleRowPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, pageId: FigPageId) => {
      if (!canEditPage || event.button !== 0) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-rename-input='true']")) {
        // Let the rename input own the pointer once it is in edit mode.
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({
        active: true,
        draggingId: pageId,
        originY: event.clientY,
        overId: undefined,
        overPosition: "after",
      });
    },
    [canEditPage],
  );

  const handleRowPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag.active) {
        return;
      }
      const distance = Math.abs(event.clientY - drag.originY);
      if (distance < DRAG_ACTIVATION_THRESHOLD_PX && drag.overId === undefined) {
        return;
      }
      const target = computeDropTarget(event.clientY);
      if (target.overId === drag.overId && target.overPosition === drag.overPosition) {
        return;
      }
      setDrag({ ...drag, overId: target.overId, overPosition: target.overPosition });
    },
    [computeDropTarget, drag],
  );

  const finalizeDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, pageId: FigPageId) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!drag.active) {
        return;
      }
      const moved = Math.abs(event.clientY - drag.originY) >= DRAG_ACTIVATION_THRESHOLD_PX;
      const fromIndex = indexById.get(drag.draggingId);
      setDrag(IDLE_DRAG);

      if (!moved) {
        // Treat as a click — select the page that was pressed.
        handleSelectPage(pageId);
        return;
      }
      if (fromIndex === undefined || drag.overId === undefined || drag.overId === drag.draggingId) {
        return;
      }
      const overIndex = indexById.get(drag.overId);
      if (overIndex === undefined) {
        return;
      }
      const insertionIndex = drag.overPosition === "before" ? overIndex : overIndex + 1;
      const adjusted = insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
      if (adjusted === fromIndex) {
        return;
      }
      movePage(drag.draggingId, adjusted);
    },
    [drag, handleSelectPage, indexById, movePage],
  );

  const handleRowPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDrag(IDLE_DRAG);
  }, []);

  const registerRenameHandle = useCallback(
    (pageId: FigPageId) => (handle: InlineRenameInputHandle | null) => {
      if (handle === null) {
        renameHandlesRef.current.delete(pageId);
        return;
      }
      renameHandlesRef.current.set(pageId, handle);
    },
    [],
  );

  return (
    <OptionalPropertySection title="Pages" badge={pageCount} defaultExpanded>
      <div style={containerStyle}>
        {pages.map((page) => {
          const isActive = page.id === activePageId;
          const isDragging = drag.active && drag.draggingId === page.id;
          const isDropTarget = drag.active && drag.overId === page.id && drag.draggingId !== page.id;
          return (
            <div
              key={page.id}
              data-page-row-id={page.id}
              role="button"
              tabIndex={0}
              aria-current={isActive ? "page" : undefined}
              aria-disabled={!canEditPage}
              style={pageRowStyle({
                active: isActive,
                dropBefore: isDropTarget && drag.overPosition === "before",
                dropAfter: isDropTarget && drag.overPosition === "after",
                dragging: isDragging,
              })}
              onPointerDown={(event) => handleRowPointerDown(event, page.id)}
              onPointerMove={handleRowPointerMove}
              onPointerUp={(event) => finalizeDrag(event, page.id)}
              onPointerCancel={handleRowPointerCancel}
              onContextMenu={(event) => handleContextMenu(event, page.id)}
            >
              <span data-rename-input="true">
                <InlineRenameInput
                  ref={registerRenameHandle(page.id)}
                  value={page.name}
                  onCommit={(next) => handleRenameCommit(page.id, next)}
                  disabled={!canEditPage}
                  ariaLabel={`Rename page ${page.name}`}
                  displayStyle={displayLabelStyle}
                />
              </span>
            </div>
          );
        })}
      </div>
      <AddItemButton label="Add page" onClick={handleAddPage} disabled={!canEditPage} />
      {menu.open && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onAction={handleMenuAction}
          onClose={closeMenu}
        />
      )}
    </OptionalPropertySection>
  );
}
