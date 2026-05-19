/** @file Kiwi CANVAS page list panel. */

import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { guidToString } from "@higma-document-models/fig/domain";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
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
import { useFigEditor } from "../../context/FigEditorContext";
import { allowsFigUserOperation } from "../../context/fig-editor/user-operation";
import { useFigOperationDomain } from "../../context/use-fig-operation-domain";

type PageContextMenuState =
  | { readonly open: false }
  | { readonly open: true; readonly pageGuid: FigGuid; readonly pageKey: string; readonly x: number; readonly y: number };

const CLOSED_MENU: PageContextMenuState = { open: false };

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

function requirePageGuid(page: FigNode): FigGuid {
  if (page.guid === undefined) {
    throw new Error(`PageListPanel: CANVAS "${page.name ?? "(unnamed)"}" is missing guid`);
  }
  return page.guid;
}

function requirePageName(page: FigNode): string {
  if (page.name === undefined || page.name.length === 0) {
    throw new Error(`PageListPanel: CANVAS ${guidToString(requirePageGuid(page))} is missing name`);
  }
  return page.name;
}

function pageKey(page: FigNode): string {
  return guidToString(requirePageGuid(page));
}

/** Render and switch CANVAS pages. */
export function PageListPanel() {
  const {
    pages,
    activePageGuid,
    setActivePageGuid,
    addPage,
    renamePage,
    deletePage,
    movePage,
  } = useFigEditor();
  const [menu, setMenu] = useState<PageContextMenuState>(CLOSED_MENU);
  const renameHandlesRef = useRef<Map<string, InlineRenameInputHandle | null>>(new Map());
  const operationDomain = useFigOperationDomain();
  const canMutatePages = allowsFigUserOperation(operationDomain, "update-property");
  const activeKey = activePageGuid ? guidToString(activePageGuid) : undefined;
  const indexByKey = useMemo(() => new Map(pages.map((page, index) => [pageKey(page), index])), [pages]);

  const registerRenameHandle = useCallback((key: string) => (handle: InlineRenameInputHandle | null): void => {
    if (handle === null) {
      renameHandlesRef.current.delete(key);
      return;
    }
    renameHandlesRef.current.set(key, handle);
  }, []);

  const openMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>, page: FigNode): void => {
    const guid = requirePageGuid(page);
    const key = guidToString(guid);
    event.preventDefault();
    event.stopPropagation();
    setMenu({ open: true, pageGuid: guid, pageKey: key, x: event.clientX, y: event.clientY });
  }, []);

  const closeMenu = useCallback((): void => setMenu(CLOSED_MENU), []);

  const menuItems = useMemo<readonly MenuEntry[]>(() => {
    if (!menu.open) {
      return [];
    }
    const currentIndex = indexByKey.get(menu.pageKey);
    if (currentIndex === undefined) {
      throw new Error(`PageListPanel: menu target ${menu.pageKey} is not present`);
    }
    return [
      { id: PAGE_MENU_ACTIONS.rename, label: "Rename", shortcut: "F2", disabled: !canMutatePages },
      { type: "separator" },
      { id: PAGE_MENU_ACTIONS.moveUp, label: "Move up", disabled: !canMutatePages || currentIndex === 0 },
      { id: PAGE_MENU_ACTIONS.moveDown, label: "Move down", disabled: !canMutatePages || currentIndex === pages.length - 1 },
      { type: "separator" },
      { id: PAGE_MENU_ACTIONS.delete, label: "Delete", danger: true, disabled: !canMutatePages || pages.length <= 1 },
    ];
  }, [canMutatePages, indexByKey, menu, pages.length]);

  const handleMenuAction = useCallback((actionId: string): void => {
    if (!menu.open || !isPageMenuActionId(actionId)) {
      return;
    }
    if (!canMutatePages) {
      return;
    }
    const currentIndex = indexByKey.get(menu.pageKey);
    if (currentIndex === undefined) {
      throw new Error(`PageListPanel: menu target ${menu.pageKey} is not present`);
    }
    if (actionId === PAGE_MENU_ACTIONS.rename) {
      renameHandlesRef.current.get(menu.pageKey)?.requestRename();
      return;
    }
    if (actionId === PAGE_MENU_ACTIONS.moveUp) {
      movePage(menu.pageGuid, currentIndex - 1, "page-panel");
      return;
    }
    if (actionId === PAGE_MENU_ACTIONS.moveDown) {
      movePage(menu.pageGuid, currentIndex + 1, "page-panel");
      return;
    }
    deletePage(menu.pageGuid, "page-panel");
  }, [canMutatePages, deletePage, indexByKey, menu, movePage]);

  return (
    <OptionalPropertySection title="Pages" badge={pages.length} defaultExpanded>
      <div role="listbox" aria-label="Pages">
        {pages.map((page) => {
          const guid = requirePageGuid(page);
          const key = guidToString(guid);
          const rowState: ListRowVisualState = { dropBefore: false, dropAfter: false, dragging: false };
          return (
            <div
              key={key}
              role="option"
              tabIndex={0}
              aria-selected={activeKey === key}
              aria-current={activeKey === key ? "page" : undefined}
              aria-label={requirePageName(page)}
              className={LIST_ROW_CLASS_NAME}
              {...listRowDataAttributes(rowState)}
              onPointerDown={() => setActivePageGuid(guid)}
              onContextMenu={(event) => openMenu(event, page)}
            >
              <InlineRenameInput
                ref={registerRenameHandle(key)}
                value={requirePageName(page)}
                onCommit={(name) => renamePage(guid, name, "page-panel")}
                disabled={!canMutatePages}
                ariaLabel={`Rename page ${requirePageName(page)}`}
              />
            </div>
          );
        })}
      </div>
      <AddItemButton
        label="Add Page"
        disabled={!canMutatePages}
        onClick={() => addPage(`Page ${pages.length + 1}`, "page-panel")}
      />
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
