/**
 * @file Tabs primitive component
 *
 * A minimal tab component for switching between content panels.
 *
 * Styling
 * -------
 * Size (`data-size`) and selected state (`aria-selected`) drive the
 * variant rules in `Tabs.module.css`. No imperative style injection,
 * no className branching.
 */

import { useState, useCallback, type ReactNode, type CSSProperties } from "react";
import styles from "./Tabs.module.css";

export type TabItem<T extends string = string> = {
  readonly id: T;
  readonly label: string;
  readonly content: ReactNode;
  readonly disabled?: boolean;
};

export type TabsProps<T extends string = string> = {
  /** Tab items to display */
  readonly items: readonly TabItem<T>[];
  /** Currently active tab ID (controlled mode) */
  readonly value?: T;
  /** Callback when active tab changes */
  readonly onChange?: (value: T) => void;
  /** Default active tab ID for uncontrolled mode */
  readonly defaultValue?: T;
  /** Tab list size */
  readonly size?: "sm" | "md";
  /** Inline style overrides */
  readonly style?: CSSProperties;
};

/**
 * A tabs component for switching between content panels.
 */
export function Tabs<T extends string = string>({
  items,
  value: controlledValue,
  onChange,
  defaultValue,
  size = "md",
  style,
}: TabsProps<T>) {
  const [internalValue, setInternalValue] = useState<T>(() => {
    if (defaultValue) {
      return defaultValue;
    }
    const firstEnabled = items.find((item) => !item.disabled);
    return firstEnabled?.id ?? items[0]?.id ?? ("" as T);
  });

  const isControlled = controlledValue !== undefined;
  const activeId = isControlled ? controlledValue : internalValue;

  const handleTabClick = useCallback(
    (id: T, disabled?: boolean) => {
      if (disabled) {
        return;
      }
      if (isControlled) {
        onChange?.(id);
      } else {
        setInternalValue(id);
        onChange?.(id);
      }
    },
    [isControlled, onChange]
  );

  const activeItem = items.find((item) => item.id === activeId);

  return (
    <div
      style={style}
      className={styles.container}
    >
      <div className={styles.tabList} role="tablist">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === activeId}
            disabled={item.disabled}
            className={styles.tab}
            data-size={size}
            onClick={() => handleTabClick(item.id, item.disabled)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className={styles.content} role="tabpanel">
        {activeItem?.content}
      </div>
    </div>
  );
}
