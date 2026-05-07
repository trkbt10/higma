/**
 * @file Right sidebar inspect panel — single-node and Mixed views.
 *
 * Single-node mode mirrors the Figma Dev Mode inspect layout:
 *   - Header: node name + type label (e.g. "Rectangle 1 — Rectangle")
 *   - Layout: width / height (local) and top / left (world AABB),
 *     plus rotation when non-zero
 *   - Colors: solid fills surfaced as hex swatches with opacity
 *   - Export: scale + format + suffix → PNG/JPEG/SVG download
 *
 * Mixed mode (2+ nodes selected) replaces the header and metric rows
 * with aggregates computed by `summarizeMixedSelection`:
 *   - Selection count + per-type histogram
 *   - Each numeric field is either the shared value or the literal
 *     "Mixed" with the min/max range underneath
 *   - Solid fills are deduped and counted, so a 50-row selection of
 *     two-color pills shows two swatches rather than 100 entries
 *   - Export controls now drive a multi-node rollup; the runner
 *     iterates the selection and emits one file per node
 *
 * The empty state appears when no node is selected and points the
 * user back at either surface that can drive selection.
 */

import { useCallback, useMemo, useState } from "react";
import type {
  FigDesignNode,
} from "@higma-document-models/fig/domain";
import type { FigPaint, FigColor } from "@higma-document-models/fig/types";

type FigNodeType = FigDesignNode["type"];
import type { NodeBounds } from "../geometry/node-bounds";
import { nodeTypeLabel } from "./node-icon";
import {
  summarizeMixedSelection,
  type MixedDimension,
  type MixedSelectionSummary,
} from "./inspect-summary";
import type { ExportFormat, ExportRequest, ExportRollupStatus } from "../export/types";

type Props = {
  readonly selectedNodes: readonly FigDesignNode[];
  readonly selectedBounds: readonly NodeBounds[];
  readonly onExport: (request: ExportRequest) => void;
  readonly exporting: boolean;
  readonly exportError: string | null;
  readonly exportStatus: ExportRollupStatus;
};

export function InspectPanel(props: Props) {
  const { selectedNodes, selectedBounds } = props;

  if (selectedNodes.length === 0) {
    return (
      <aside className="higma-fig-sidebar higma-fig-sidebar--right" aria-label="Inspect">
        <div className="higma-fig-inspect__empty">
          Select a layer in the canvas or layers panel to inspect it.
          <br />
          Cmd/Ctrl-click to add to the selection, Shift-click for a range.
        </div>
      </aside>
    );
  }

  if (selectedNodes.length === 1) {
    const node = selectedNodes[0];
    const bounds = selectedBounds[0];
    if (!node || !bounds) {
      return null;
    }
    return (
      <aside className="higma-fig-sidebar higma-fig-sidebar--right" aria-label="Inspect">
        <SingleHeader node={node} />
        <SingleLayoutSection node={node} bounds={bounds} />
        <SingleColorsSection fills={node.fills} />
        <ExportSection
          nodeCount={1}
          primaryName={node.name || nodeTypeLabel(node.type)}
          onExport={props.onExport}
          exporting={props.exporting}
          exportError={props.exportError}
          exportStatus={props.exportStatus}
        />
      </aside>
    );
  }

  return (
    <aside className="higma-fig-sidebar higma-fig-sidebar--right" aria-label="Inspect">
      <MixedView
        nodes={selectedNodes}
        bounds={selectedBounds}
        onExport={props.onExport}
        exporting={props.exporting}
        exportError={props.exportError}
        exportStatus={props.exportStatus}
      />
    </aside>
  );
}

// ----------------------------------------------------------------------
// Single-node view
// ----------------------------------------------------------------------

type SingleHeaderProps = { readonly node: FigDesignNode };

function SingleHeader({ node }: SingleHeaderProps) {
  return (
    <header className="higma-fig-inspect__header">
      <h2 className="higma-fig-inspect__name" title={node.name}>
        {node.name || nodeTypeLabel(node.type)}
      </h2>
      <p className="higma-fig-inspect__type">{nodeTypeLabel(node.type)}</p>
    </header>
  );
}

type SingleLayoutSectionProps = {
  readonly node: FigDesignNode;
  readonly bounds: NodeBounds;
};

function SingleLayoutSection({ node, bounds }: SingleLayoutSectionProps) {
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

type SingleColorsSectionProps = {
  readonly fills: readonly FigPaint[];
};

function SingleColorsSection({ fills }: SingleColorsSectionProps) {
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
  const stops = paint.stops ?? paint.gradientStops ?? [];
  const first = stops[0]?.color;
  const last = stops[stops.length - 1]?.color;
  if (!first || !last) {
    return "var(--vscode-editorWidget-background)";
  }
  return `linear-gradient(90deg, ${rgbaCss(first, paint.opacity)}, ${rgbaCss(last, paint.opacity)})`;
}

// ----------------------------------------------------------------------
// Mixed view (2+ nodes)
// ----------------------------------------------------------------------

type MixedViewProps = {
  readonly nodes: readonly FigDesignNode[];
  readonly bounds: readonly NodeBounds[];
  readonly onExport: (request: ExportRequest) => void;
  readonly exporting: boolean;
  readonly exportError: string | null;
  readonly exportStatus: ExportRollupStatus;
};

function MixedView({ nodes, bounds, onExport, exporting, exportError, exportStatus }: MixedViewProps) {
  const summary = useMemo(() => summarizeMixedSelection(nodes, bounds), [nodes, bounds]);
  return (
    <>
      <MixedHeader summary={summary} />
      <MixedTypesSection summary={summary} />
      <MixedLayoutSection summary={summary} />
      <MixedColorsSection summary={summary} />
      <ExportSection
        nodeCount={summary.count}
        primaryName={null}
        onExport={onExport}
        exporting={exporting}
        exportError={exportError}
        exportStatus={exportStatus}
      />
    </>
  );
}

function MixedHeader({ summary }: { readonly summary: MixedSelectionSummary }) {
  const subtitle = formatMixedSubtitle(summary);
  return (
    <header className="higma-fig-inspect__header">
      <h2 className="higma-fig-inspect__name">{summary.count} layers selected</h2>
      <p className="higma-fig-inspect__type">{subtitle}</p>
    </header>
  );
}

function formatMixedSubtitle(summary: MixedSelectionSummary): string {
  if (summary.hiddenCount > 0) {
    return `${summary.visibleCount} visible · ${summary.hiddenCount} hidden`;
  }
  return `${summary.count} layers`;
}

function MixedTypesSection({ summary }: { readonly summary: MixedSelectionSummary }) {
  if (summary.typeCounts.length === 0) {
    return null;
  }
  return (
    <section className="higma-fig-inspect__section" aria-labelledby="higma-inspect-types">
      <h3 id="higma-inspect-types" className="higma-fig-inspect__section-title">
        Types
      </h3>
      <ul className="higma-fig-inspect__chips">
        {summary.typeCounts.map((entry) => (
          <li key={entry.type} className="higma-fig-inspect__chip">
            <span className="higma-fig-inspect__chip-label">{nodeTypeLabel(entry.type as FigNodeType)}</span>
            <span className="higma-fig-inspect__chip-count">×{entry.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MixedLayoutSection({ summary }: { readonly summary: MixedSelectionSummary }) {
  return (
    <section className="higma-fig-inspect__section" aria-labelledby="higma-inspect-mixed-layout">
      <h3 id="higma-inspect-mixed-layout" className="higma-fig-inspect__section-title">
        Layout
      </h3>
      <dl className="higma-fig-inspect__metrics">
        <DimensionMetric label="Width" dim={summary.width} unit="px" />
        <DimensionMetric label="Height" dim={summary.height} unit="px" />
        <Metric label="Top" value={`${formatDimension(summary.union.y)}px`} />
        <Metric label="Left" value={`${formatDimension(summary.union.x)}px`} />
        <Metric label="Bounds" value={`${formatDimension(summary.union.width)} × ${formatDimension(summary.union.height)}px`} />
        {summary.opacity.kind === "uniform" && summary.opacity.value < 1 && (
          <Metric label="Opacity" value={`${Math.round(summary.opacity.value * 100)}%`} />
        )}
        {summary.opacity.kind === "mixed" && (
          <Metric
            label="Opacity"
            value={`Mixed (${Math.round(summary.opacity.min * 100)}–${Math.round(
              summary.opacity.max * 100,
            )}%)`}
          />
        )}
      </dl>
    </section>
  );
}

function MixedColorsSection({ summary }: { readonly summary: MixedSelectionSummary }) {
  if (
    summary.solidFills.length === 0 &&
    !summary.hasGradientFill &&
    !summary.hasImageFill
  ) {
    return null;
  }
  return (
    <section className="higma-fig-inspect__section" aria-labelledby="higma-inspect-mixed-colors">
      <h3 id="higma-inspect-mixed-colors" className="higma-fig-inspect__section-title">
        Colors
      </h3>
      <ul className="higma-fig-inspect__colors">
        {summary.solidFills.map((entry) => (
          <li key={`${entry.hex}-${entry.alpha.toFixed(3)}`} className="higma-fig-inspect__color-row">
            <span
              className="higma-fig-inspect__swatch"
              style={{ background: hexAlphaToCss(entry.hex, entry.alpha) }}
              aria-hidden="true"
            />
            <span className="higma-fig-inspect__color-hex">{entry.hex}</span>
            {entry.alpha < 0.999 && (
              <span className="higma-fig-inspect__color-alpha">{Math.round(entry.alpha * 100)}%</span>
            )}
            <span className="higma-fig-inspect__color-count">×{entry.count}</span>
          </li>
        ))}
        {summary.hasGradientFill && (
          <li className="higma-fig-inspect__color-row">
            <span className="higma-fig-inspect__swatch higma-fig-inspect__swatch--gradient" aria-hidden="true" />
            <span className="higma-fig-inspect__color-hex">Gradient(s)</span>
          </li>
        )}
        {summary.hasImageFill && (
          <li className="higma-fig-inspect__color-row">
            <span className="higma-fig-inspect__swatch higma-fig-inspect__swatch--image" aria-hidden="true" />
            <span className="higma-fig-inspect__color-hex">Image(s)</span>
          </li>
        )}
      </ul>
    </section>
  );
}

function DimensionMetric({
  label,
  dim,
  unit,
}: {
  readonly label: string;
  readonly dim: MixedDimension;
  readonly unit: string;
}) {
  if (dim.kind === "uniform") {
    return <Metric label={label} value={`${formatDimension(dim.value)}${unit}`} />;
  }
  return (
    <>
      <dt className="higma-fig-inspect__metric-label">{label}</dt>
      <dd className="higma-fig-inspect__metric-value higma-fig-inspect__metric-value--mixed">
        Mixed
        <span className="higma-fig-inspect__metric-range">
          {formatDimension(dim.min)}–{formatDimension(dim.max)}
          {unit}
        </span>
      </dd>
    </>
  );
}

// ----------------------------------------------------------------------
// Export controls (shared between single + mixed)
// ----------------------------------------------------------------------

type ExportSectionProps = {
  readonly nodeCount: number;
  readonly primaryName: string | null;
  readonly onExport: (request: ExportRequest) => void;
  readonly exporting: boolean;
  readonly exportError: string | null;
  readonly exportStatus: ExportRollupStatus;
};

const SCALE_OPTIONS = [0.5, 1, 2, 3, 4] as const;
const FORMAT_OPTIONS: readonly ExportFormat[] = ["PNG", "JPEG", "SVG"];

function ExportSection({
  nodeCount,
  primaryName,
  onExport,
  exporting,
  exportError,
  exportStatus,
}: ExportSectionProps) {
  const [scale, setScale] = useState<number>(1);
  const [format, setFormat] = useState<ExportFormat>("PNG");
  const [suffix, setSuffix] = useState<string>("");

  const buttonLabel = useMemo(() => {
    if (exporting) {
      if (exportStatus.kind === "running") {
        return `Exporting ${exportStatus.completed}/${exportStatus.total}…`;
      }
      return "Exporting…";
    }
    if (nodeCount > 1) {
      return `Export ${nodeCount} layers`;
    }
    if (primaryName) {
      const truncated = primaryName.length > 20 ? `${primaryName.slice(0, 17)}…` : primaryName;
      return `Export ${truncated}`;
    }
    return "Export";
  }, [exporting, exportStatus, nodeCount, primaryName]);

  const handleExport = useCallback(() => {
    onExport({ format, scale, suffix: suffix.trim() });
  }, [format, scale, suffix, onExport]);

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
        disabled={exporting || nodeCount === 0}
      >
        {buttonLabel}
      </button>
      <ExportStatusReadout status={exportStatus} />
      {exportError && <div className="higma-fig-inspect__export-error">{exportError}</div>}
    </section>
  );
}

function ExportStatusReadout({ status }: { readonly status: ExportRollupStatus }) {
  if (status.kind === "idle") {
    return null;
  }
  if (status.kind === "running") {
    return (
      <div className="higma-fig-inspect__export-progress">
        Exporting {status.completed} of {status.total}…
      </div>
    );
  }
  if (status.failed.length === 0) {
    return (
      <div className="higma-fig-inspect__export-success">
        Exported {status.succeeded} {status.succeeded === 1 ? "layer" : "layers"}.
      </div>
    );
  }
  return (
    <div className="higma-fig-inspect__export-error">
      Exported {status.succeeded}; failed {status.failed.length}:
      <ul className="higma-fig-inspect__export-failures">
        {status.failed.slice(0, 3).map((entry, idx) => (
          <li key={idx}>
            <code>{entry.name}</code>: {entry.message}
          </li>
        ))}
        {status.failed.length > 3 && <li>…and {status.failed.length - 3} more</li>}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------------
// Shared helpers
// ----------------------------------------------------------------------

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

function hexAlphaToCss(hex: string, alpha: number): string {
  const value = hex.replace(/^#/, "");
  if (value.length !== 6) {
    return hex;
  }
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
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
