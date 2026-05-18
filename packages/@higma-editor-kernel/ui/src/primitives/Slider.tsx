/**
 * @file Slider primitive component
 *
 * A minimal range slider component.
 *
 * Styling
 * -------
 * Cross-engine thumb styling lives in `Slider.module.css`. No
 * imperative style injection, no className branching.
 */

import { useCallback, type ChangeEvent, type CSSProperties } from "react";
import styles from "./Slider.module.css";

export type SliderProps = {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly disabled?: boolean;
  readonly style?: CSSProperties;
  readonly showValue?: boolean;
  readonly suffix?: string;
};

/**
 * Slider input with optional value display.
 */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  style,
  showValue = true,
  suffix = "",
}: SliderProps) {
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onChange(parseFloat(e.target.value));
    },
    [onChange]
  );

  return (
    <div
      style={style}
      className={styles.container}
    >
      <input
        type="range"
        value={value}
        onChange={handleChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={styles.slider}
      />
      {showValue && (
        <span className={styles.value}>
          {value}
          {suffix}
        </span>
      )}
    </div>
  );
}
