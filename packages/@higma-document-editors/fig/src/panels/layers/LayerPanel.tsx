/** @file Kiwi layer tree panel. */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { guidToString, getNodeType } from "@higma-document-models/fig/domain";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DiamondIcon,
  EllipseIcon,
  FolderIcon,
  FrameIcon,
  HiddenIcon,
  LineIcon,
  RectIcon,
  StarIcon,
  TextBoxIcon,
  UnknownShapeIcon,
  VisibleIcon,
} from "@higma-editor-kernel/ui/icons";
import { useFigEditor } from "../../context/FigEditorContext";
import { allowsFigUserOperation } from "../../context/fig-editor/user-operation";
import { useFigOperationDomain } from "../../context/use-fig-operation-domain";
import { getLayerNodePresentation } from "./layer-node-presentation";
import styles from "./LayerPanel.module.css";

const ICON_SIZE = 14;
const DISCLOSURE_SIZE = 18;
const ROW_INDENT_PX = 14;

function requireGuid(node: FigNode): FigGuid {
  if (node.guid === undefined) {
    throw new Error(`LayerPanel: Kiwi node "${node.name ?? "(unnamed)"}" is missing guid`);
  }
  return node.guid;
}

function nodeIcon(node: FigNode): ReactNode {
  switch (getNodeType(node)) {
    case "FRAME":
    case "SECTION":
      return <FrameIcon size={ICON_SIZE} />;
    case "GROUP":
      return <FolderIcon size={ICON_SIZE} />;
    case "TEXT":
      return <TextBoxIcon size={ICON_SIZE} />;
    case "RECTANGLE":
    case "ROUNDED_RECTANGLE":
      return <RectIcon size={ICON_SIZE} />;
    case "ELLIPSE":
      return <EllipseIcon size={ICON_SIZE} />;
    case "VECTOR":
    case "LINE":
      return <LineIcon size={ICON_SIZE} />;
    case "STAR":
      return <StarIcon size={ICON_SIZE} />;
    case "INSTANCE":
    case "SYMBOL":
      return <DiamondIcon size={ICON_SIZE} />;
    default:
      return <UnknownShapeIcon size={ICON_SIZE} />;
  }
}

function LayerTypeBadge({ typeName }: { readonly typeName: string }) {
  return <span className={styles.badge}>{typeName}</span>;
}

function LayerNameEditor({
  label,
  renaming,
  requestRename,
  cancelRename,
  onCommit,
}: {
  readonly label: string;
  readonly renaming: boolean;
  readonly requestRename: () => void;
  readonly cancelRename: () => void;
  readonly onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(label);

  useEffect(() => {
    if (!renaming) {
      setDraft(label);
    }
  }, [label, renaming]);

  const commit = useCallback((): void => {
    const name = draft.trim();
    if (name.length > 0 && name !== label) {
      onCommit(name);
    }
    cancelRename();
  }, [cancelRename, draft, label, onCommit]);

  const cancel = useCallback((): void => {
    setDraft(label);
    cancelRename();
  }, [cancelRename, label]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }, [cancel, commit]);

  if (renaming) {
    return (
      <input
        aria-label={`Rename ${label}`}
        className={styles.renameInput}
        value={draft}
        onBlur={commit}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
        autoFocus
      />
    );
  }

  return (
    <span className={styles.label} onDoubleClick={requestRename}>
      {label}
    </span>
  );
}

function renderLayerDisclosure({
  childCount,
  expanded,
  label,
  id,
  toggleCollapsed,
}: {
  readonly childCount: number;
  readonly expanded: boolean;
  readonly label: string;
  readonly id: string;
  readonly toggleCollapsed: (id: string) => void;
}): ReactNode {
  if (childCount === 0) {
    return <span className={styles.disclosureSpacer} />;
  }
  return (
    <button
      type="button"
      className={styles.iconButton}
      aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        toggleCollapsed(id);
      }}
    >
      {expanded ? <ChevronDownIcon size={DISCLOSURE_SIZE} /> : <ChevronRightIcon size={DISCLOSURE_SIZE} />}
    </button>
  );
}

function renderChildLayerRows({
  expanded,
  children,
  depth,
  selectedIds,
  collapsedIds,
  canSelect,
  canMutate,
  toggleCollapsed,
}: {
  readonly expanded: boolean;
  readonly children: readonly FigNode[];
  readonly depth: number;
  readonly selectedIds: ReadonlySet<string>;
  readonly collapsedIds: ReadonlySet<string>;
  readonly canSelect: boolean;
  readonly canMutate: boolean;
  readonly toggleCollapsed: (id: string) => void;
}): ReactNode {
  if (!expanded) {
    return null;
  }
  return children.map((child) => (
    <LayerRow
      key={guidToString(requireGuid(child))}
      node={child}
      depth={depth + 1}
      selectedIds={selectedIds}
      collapsedIds={collapsedIds}
      canSelect={canSelect}
      canMutate={canMutate}
      toggleCollapsed={toggleCollapsed}
    />
  ));
}

function LayerRow({
  node,
  depth,
  selectedIds,
  collapsedIds,
  canSelect,
  canMutate,
  toggleCollapsed,
}: {
  readonly node: FigNode;
  readonly depth: number;
  readonly selectedIds: ReadonlySet<string>;
  readonly collapsedIds: ReadonlySet<string>;
  readonly canSelect: boolean;
  readonly canMutate: boolean;
  readonly toggleCollapsed: (id: string) => void;
}) {
  const { context, selectNodeGuid, updateNode } = useFigEditor();
  const guid = requireGuid(node);
  const id = guidToString(guid);
  const presentation = getLayerNodePresentation(node);
  const children = context.document.childrenOf(node);
  const selected = selectedIds.has(id);
  const expanded = !collapsedIds.has(id);
  const visible = node.visible !== false;
  const [renaming, setRenaming] = useState(false);

  const select = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    if (!canSelect) {
      return;
    }
    selectNodeGuid(guid, {
      additive: event.shiftKey || event.metaKey || event.ctrlKey,
      toggle: event.metaKey || event.ctrlKey,
    });
  }, [canSelect, guid, selectNodeGuid]);

  const rename = useCallback((name: string): void => {
    updateNode(guid, (current) => ({ ...current, name }), "layer-panel");
  }, [guid, updateNode]);

  const requestRename = useCallback((): void => {
    if (!canMutate) {
      return;
    }
    setRenaming(true);
  }, [canMutate]);

  const cancelRename = useCallback((): void => {
    setRenaming(false);
  }, []);

  const toggleVisibility = useCallback((): void => {
    updateNode(guid, (current) => ({ ...current, visible: !visible }), "layer-panel");
  }, [guid, updateNode, visible]);

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={children.length > 0 ? expanded : undefined}
        aria-selected={selected}
        className={`${styles.row} ${selected ? styles.rowSelected : ""}`}
        style={{ paddingLeft: 8 + depth * ROW_INDENT_PX }}
        onDoubleClick={requestRename}
        onPointerDown={select}
      >
        {renderLayerDisclosure({
          childCount: children.length,
          expanded,
          label: presentation.label,
          id,
          toggleCollapsed,
        })}
        <span className={styles.icon}>{nodeIcon(node)}</span>
        <LayerNameEditor
          label={presentation.label}
          renaming={renaming}
          requestRename={requestRename}
          cancelRename={cancelRename}
          onCommit={rename}
        />
        <LayerTypeBadge typeName={presentation.typeName} />
        <button
          type="button"
          className={styles.iconButton}
          aria-label={visible ? `Hide ${presentation.label}` : `Show ${presentation.label}`}
          disabled={!canMutate}
          onClick={(event) => {
            event.stopPropagation();
            toggleVisibility();
          }}
        >
          {visible ? <VisibleIcon size={ICON_SIZE} /> : <HiddenIcon size={ICON_SIZE} />}
        </button>
      </div>
      {renderChildLayerRows({
        expanded,
        children,
        depth,
        selectedIds,
        collapsedIds,
        canSelect,
        canMutate,
        toggleCollapsed,
      })}
    </>
  );
}

/** Render the active CANVAS node hierarchy. */
export function LayerPanel() {
  const { activePage, context, selectedGuids } = useFigEditor();
  const operationDomain = useFigOperationDomain();
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());
  const selectedIds = useMemo(() => new Set(selectedGuids.map(guidToString)), [selectedGuids]);
  const canSelect = allowsFigUserOperation(operationDomain, "select-node");
  const canMutate = allowsFigUserOperation(operationDomain, "update-property");
  const toggleCollapsed = useCallback((id: string): void => {
    setCollapsedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      next.add(id);
      return next;
    });
  }, []);
  if (activePage === undefined) {
    throw new Error("LayerPanel requires an active CANVAS");
  }
  const children = context.document.childrenOf(activePage);
  return (
    <section className={styles.root}>
      <div className={styles.header}>Layers</div>
      <div className={styles.list} role="tree" aria-label="Layers">
        {children.map((node) => (
          <LayerRow
            key={guidToString(requireGuid(node))}
            node={node}
            depth={0}
            selectedIds={selectedIds}
            collapsedIds={collapsedIds}
            canSelect={canSelect}
            canMutate={canMutate}
            toggleCollapsed={toggleCollapsed}
          />
        ))}
      </div>
    </section>
  );
}
