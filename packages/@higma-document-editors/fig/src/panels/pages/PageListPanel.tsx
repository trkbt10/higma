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
  listRowDataAttributes,
  LIST_ROW_CLASS_NAME,
  type InlineRenameInputHandle,
  type ListRowVisualState,
  type MenuEntry,
} from "@higma-editor-kernel/ui";
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

/**
 * Row styling is delegated to the kernel's `SelectableListRow` SoT
 * (see `@higma-editor-kernel/ui` → `SelectableListRow.ts`). Pages and
 * Layers are both vertical lists of selectable items, and previously
 * each panel defined its own row style — that produced inconsistent
 * row heights, divergent hover/selection palettes, and a
 * `border-radius` on Pages rows that curved the focus outline and
 * drop indicator into rounded "stickers". The SoT fixes those
 * contracts in one place.
 */

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  // Gap is 0 so consecutive rows stack edge-to-edge — the row SoT
  // declares its own 28px height and a drop indicator drawn as an
  // inset 2px box-shadow at the row edge reads as a clean horizontal
  // insertion line. A gap between rows would split that line into
  // two short segments.
  gap: 0,
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

  // Row pseudo-class rules come from `SelectableListRow.module.css`
  // via the SoT's CSS-Module-hashed `LIST_ROW_CLASS_NAME`. No
  // imperative style injection at runtime.

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
      // Only bail when the pointer lands on the actual editable
      // surface — the rename input in edit mode. The previous guard
      // matched a wrapper span carrying `data-rename-input="true"`
      // around the *whole* row content, so pointer-down on the row's
      // display text (which sits inside that wrapper) always returned
      // early and drag-reorder never started. The display state has
      // no `<input>` mounted, so the narrowed guard only fires once
      // the user has actually entered edit mode.
      if (target?.closest("input, textarea, [contenteditable='true']")) {
        return;
      }
      // Record the press but DO NOT call `setPointerCapture` yet.
      // Calling capture immediately on pointerdown interferes with
      // native dblclick dispatch in headless Chromium — operators
      // would press-release-press-release on a row name and see no
      // rename open. We claim the pointer only once movement crosses
      // the drag-activation threshold in `handleRowPointerMove`.
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
      // First crossing of the threshold — claim the pointer now so
      // subsequent moves outside the originating row still reach this
      // handler. Idempotent: subsequent moves are no-ops once capture
      // is held.
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId);
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
      {/*
        Page list is a single-selection listbox: each row is an option,
        the active page is the selected option. Previously the row div
        also carried role="button" which doubled up with the inner
        InlineRenameInput's role="button" — screen readers and `getByRole`
        both saw two overlapping buttons sharing an accessible name.
      */}
      <div style={containerStyle} role="listbox" aria-label="Pages">
        {pages.map((page) => {
          const isActive = page.id === activePageId;
          const isDragging = drag.active && drag.draggingId === page.id;
          const isDropTarget = drag.active && drag.overId === page.id && drag.draggingId !== page.id;
          const rowState: ListRowVisualState = {
            dropBefore: isDropTarget && drag.overPosition === "before",
            dropAfter: isDropTarget && drag.overPosition === "after",
            dragging: isDragging,
          };
          return (
            <div
              key={page.id}
              data-page-row-id={page.id}
              role="option"
              tabIndex={0}
              aria-selected={isActive}
              aria-current={isActive ? "page" : undefined}
              aria-disabled={!canEditPage}
              aria-label={page.name}
              className={LIST_ROW_CLASS_NAME}
              {...listRowDataAttributes(rowState)}
              onPointerDown={(event) => handleRowPointerDown(event, page.id)}
              onPointerMove={handleRowPointerMove}
              onPointerUp={(event) => finalizeDrag(event, page.id)}
              onPointerCancel={handleRowPointerCancel}
              onContextMenu={(event) => handleContextMenu(event, page.id)}
            >
              <InlineRenameInput
                ref={registerRenameHandle(page.id)}
                value={page.name}
                onCommit={(next) => handleRenameCommit(page.id, next)}
                disabled={!canEditPage}
                ariaLabel={`Rename page ${page.name}`}
                displayStyle={displayLabelStyle}
              />
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
