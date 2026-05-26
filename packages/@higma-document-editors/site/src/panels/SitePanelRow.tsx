/**
 * @file Shared label/value row primitives reused by panels and CMS pages.
 */

import type { ReactNode } from "react";
import { Input } from "@higma-editor-kernel/ui/primitives/Input";

import { sitePanelRowStyle, sitePanelValueStyle } from "./site-panel-styles";

function readNumberInput(value: string | number, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    throw new Error(`Site property ${label} requires a finite number`);
  }
  if (value.trim() === "") {
    throw new Error(`Site property ${label} requires a finite number`);
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  throw new Error(`Site property ${label} requires a finite number`);
}

export type SitePropertyRowProps = {
  readonly label: string;
  readonly value: string | number;
  readonly valueRender?: (value: string | number) => ReactNode;
};

/** Read-only label/value row aligned to the site panel grid. */
export function SitePropertyRow({ label, value, valueRender }: SitePropertyRowProps) {
  return (
    <div style={sitePanelRowStyle}>
      <span>{label}</span>
      <output aria-label={`${label} value`} style={sitePanelValueStyle}>
        {valueRender ? valueRender(value) : value}
      </output>
    </div>
  );
}

export type SiteNumericPropertyRowProps = {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
};

/** Editable numeric label/value row. */
export function SiteNumericPropertyRow({ label, value, onChange }: SiteNumericPropertyRowProps) {
  return (
    <div style={sitePanelRowStyle}>
      <span>{label}</span>
      <Input
        type="number"
        value={Math.round(value)}
        ariaLabel={label}
        width={96}
        onChange={(nextValue) => onChange(readNumberInput(nextValue, label))}
      />
    </div>
  );
}
