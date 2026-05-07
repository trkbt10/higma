/**
 * @file Right sidebar inspect panel.
 *
 * Mirrors the Figma Dev Mode inspect layout:
 *   - Header: node name + type label (e.g. "Rectangle 1 — Rectangle")
 *   - Layout: width / height (local) and top / left (world AABB),
 *     plus rotation when non-zero
 *   - Colors: solid fills surfaced as hex swatches with opacity
 *   - Export: scale + format + suffix → PNG/JPEG/SVG download
 *
 * The "Properties" border-box visualization Figma shows for auto-layout
 * nodes is intentionally omitted: it depends on padding/margin
 * primitives that are auto-layout-specific, not generic to every fig
 * node. A future enhancement can read `autoLayout.{paddingTop,…}` to
 * fill it in.
 */

import { useCallback, useMemo, useState } from "react";
import type {
  FigDesignDocument,
  FigDesignNode,
  FigPage,
} from "@higma-document-models/fig/domain";
import type { FigPaint, FigColor } from "@higma-document-models/fig/types";
import type { NodeBounds } from "../geometry/node-bounds";
import { nodeTypeLabel } from "./node-icon";
import type { ExportFormat, ExportRequest } from "../export/types";

type Props = {
  readonly document: FigDesignDocument;
  readonly page: FigPage | null;
  readonly selectedNode: FigDesignNode | null;
  readonly selectedBounds: NodeBounds | null;
  readonly onExport: (request: ExportRequest) => void;
  readonly exporting: boolean;
  readonly exportError: string | null;
};






export function InspectPanel(props: Props) {
  const { selectedNode, selectedBounds } = props;

  if (!selectedNode || !selectedBounds) {
    return (
      <aside className="higma-fig-sidebar higma-fig-sidebar--right" aria-label="Inspect">
        <div className="higma-fig-inspect__empty">
          Select a layer in the canvas or layers panel to inspect it.
        </div>
      </aside>
    );
  }

  return (
    <aside className="higma-fig-sidebar higma-fig-sidebar--right" aria-label="Inspect">
      <InspectHeader node={selectedNode} />
      <LayoutSection node={selectedNode} bounds={selectedBounds} />
      <ColorsSection fills={selectedNode.fills} />
      <ExportSection
        node={selectedNode}
        onExport={props.onExport}
        exporting={props.exporting}
        exportError={props.exportError}
      />
    </aside>
  );
}

type HeaderProps = { readonly node: FigDesignNode };

function InspectHeader({ node }: HeaderProps) {
  return (
    <header className="higma-fig-inspect__header">
      <h2 className="higma-fig-inspect__name" title={node.name}>
        {node.name || nodeTypeLabel(node.type)}
      </h2>
      <p className="higma-fig-inspect__type">{nodeTypeLabel(node.type)}</p>
    </header>
  );
}

type LayoutSectionProps = {
  readonly node: FigDesignNode;
  readonly bounds: NodeBounds;
};

function LayoutSection({ node, bounds }: LayoutSectionProps) {
  const rotationDeg = computeRotationDegrees(node.transform.m00, node.transform.m10);
  return (
    <section className="higma-fig-inspect__section" aria-labelledby="higma-inspect-layout">
      <h3 id="higma-inspect-layout" className="higma-fig-inspect__section-title">
        Layout
      </h3>
      <dl className="higma-fig-inspect__metrics">
        <Metric label="Width" value={`${formatDimension(node.size.x)}px`} />
        <Metric label="Height" value={`${formatDimension(node.size.y)}px`} />
        <Metric label="Top" value={`${formatDimension(bounds.y)}px`} />
        <Metric label="Left" value={`${formatDimension(bounds.x)}px`} />
        {Math.abs(rotationDeg) > 0.01 && (
          <Metric label="Rotation" value={`${formatDimension(rotationDeg)}°`} />
        )}
        {node.opacity < 1 && (
          <Metric label="Opacity" value={`${Math.round(node.opacity * 100)}%`} />
        )}
      </dl>
    </section>
  );
}

type MetricProps = {
  readonly label: string;
  readonly value: string;
};

function Metric({ label, value }: MetricProps) {
  return (
    <>
      <dt className="higma-fig-inspect__metric-label">{label}</dt>
      <dd className="higma-fig-inspect__metric-value">{value}</dd>
    </>
  );
}

type ColorsSectionProps = {
  readonly fills: readonly FigPaint[];
};

function ColorsSection({ fills }: ColorsSectionProps) {
  // Hidden paints (`visible === false`) are excluded so the inspect
  // panel mirrors what is actually drawn on the canvas.
  const visibleFills = fills.filter((paint) => paint.visible !== false);
  if (visibleFills.length === 0) {
    return null;
  }
  return (
    <section className="higma-fig-inspect__section" aria-labelledby="higma-inspect-colors">
      <h3 id="higma-inspect-colors" className="higma-fig-inspect__section-title">
        Colors
      </h3>
      <ul className="higma-fig-inspect__colors">
        {visibleFills.map((paint, index) => (
          <PaintRow key={index} paint={paint} />
        ))}
      </ul>
    </section>
  );
}

function PaintRow({ paint }: { readonly paint: FigPaint }) {
  if (paint.type === "SOLID") {
    const { color } = paint;
    const hex = colorToHex(color);
    const alpha = combineOpacity(color.a, paint.opacity);
    return (
      <li className="higma-fig-inspect__color-row">
        <span
          className="higma-fig-inspect__swatch"
          style={{ background: rgbaCss(color, paint.opacity) }}
          aria-hidden="true"
        />
        <span className="higma-fig-inspect__color-hex">{hex}</span>
        {alpha < 0.999 && (
          <span className="higma-fig-inspect__color-alpha">{Math.round(alpha * 100)}%</span>
        )}
      </li>
    );
  }
  if (paint.type === "IMAGE") {
    return (
      <li className="higma-fig-inspect__color-row">
        <span className="higma-fig-inspect__swatch higma-fig-inspect__swatch--image" aria-hidden="true" />
        <span className="higma-fig-inspect__color-hex">Image</span>
      </li>
    );
  }
  // Gradient (linear/radial/angular/diamond) — show first/last stops.
  const swatchBg = gradientSwatchBackground(paint);
  return (
    <li className="higma-fig-inspect__color-row">
      <span className="higma-fig-inspect__swatch" style={{ background: swatchBg }} aria-hidden="true" />
      <span className="higma-fig-inspect__color-hex">{gradientLabel(paint.type)}</span>
    </li>
  );
}

const GRADIENT_LABELS: Record<string, string> = {
  GRADIENT_LINEAR: "Linear gradient",
  GRADIENT_RADIAL: "Radial gradient",
  GRADIENT_ANGULAR: "Angular gradient",
  GRADIENT_DIAMOND: "Diamond gradient",
};

function gradientLabel(type: string): string {
  return GRADIENT_LABELS[type] ?? "Gradient";
}

function gradientSwatchBackground(paint: Extract<FigPaint, { stops?: unknown }>): string {
  const stops = paint.stops ?? [];
  const first = stops[0]?.color;
  const last = stops[stops.length - 1]?.color;
  if (!first || !last) {
    return "var(--vscode-editorWidget-background)";
  }
  return `linear-gradient(90deg, ${rgbaCss(first, paint.opacity)}, ${rgbaCss(last, paint.opacity)})`;
}

type ExportSectionProps = {
  readonly node: FigDesignNode;
  readonly onExport: (request: ExportRequest) => void;
  readonly exporting: boolean;
  readonly exportError: string | null;
};

const SCALE_OPTIONS = [0.5, 1, 2, 3, 4] as const;
const FORMAT_OPTIONS: readonly ExportFormat[] = ["PNG", "JPEG", "SVG"];

function ExportSection({ node, onExport, exporting, exportError }: ExportSectionProps) {
  const [scale, setScale] = useState<number>(1);
  const [format, setFormat] = useState<ExportFormat>("PNG");
  const [suffix, setSuffix] = useState<string>("");

  const buttonLabel = useMemo(() => {
    const truncated = node.name.length > 20 ? `${node.name.slice(0, 17)}…` : node.name;
    return `Export ${truncated || nodeTypeLabel(node.type)}`;
  }, [node.name, node.type]);

  const handleExport = useCallback(() => {
    onExport({
      nodeId: node.id,
      format,
      scale,
      suffix: suffix.trim(),
      baseName: node.name || nodeTypeLabel(node.type),
    });
  }, [node, format, scale, suffix, onExport]);

  return (
    <section className="higma-fig-inspect__section" aria-labelledby="higma-inspect-export">
      <h3 id="higma-inspect-export" className="higma-fig-inspect__section-title">
        Export
      </h3>
      <div className="higma-fig-inspect__export-row">
        <label className="higma-fig-inspect__export-field">
          <span className="higma-fig-inspect__export-label">Scale</span>
          <select
            className="higma-fig-select"
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          >
            {SCALE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}x
              </option>
            ))}
          </select>
        </label>
        <label className="higma-fig-inspect__export-field">
          <span className="higma-fig-inspect__export-label">Suffix</span>
          <input
            type="text"
            className="higma-fig-input"
            placeholder="@1x"
            value={suffix}
            onChange={(e) => setSuffix(e.target.value)}
          />
        </label>
        <label className="higma-fig-inspect__export-field">
          <span className="higma-fig-inspect__export-label">Format</span>
          <select
            className="higma-fig-select"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            {FORMAT_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="button"
        className="higma-fig-button higma-fig-button--primary higma-fig-inspect__export-button"
        onClick={handleExport}
        disabled={exporting}
      >
        {exporting ? "Exporting…" : buttonLabel}
      </button>
      {exportError && <div className="higma-fig-inspect__export-error">{exportError}</div>}
    </section>
  );
}

function colorToHex(color: FigColor): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function rgbaCss(color: FigColor, paintOpacity: number | undefined): string {
  const a = combineOpacity(color.a, paintOpacity);
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

function combineOpacity(colorAlpha: number, paintOpacity: number | undefined): number {
  const base = Number.isFinite(colorAlpha) ? colorAlpha : 1;
  const factor = paintOpacity === undefined ? 1 : paintOpacity;
  return Math.max(0, Math.min(1, base * factor));
}

function computeRotationDegrees(m00: number, m10: number): number {
  return (Math.atan2(m10, m00) * 180) / Math.PI;
}

function formatDimension(value: number): string {
  if (Math.abs(value - Math.round(value)) < 0.05) {
    return `${Math.round(value)}`;
  }
  return value.toFixed(2);
}
