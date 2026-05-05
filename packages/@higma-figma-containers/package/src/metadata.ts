/**
 * @file Figma-family package metadata
 */

export type FigPackageMetadata = {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly rawKeys: readonly string[];
  readonly clientMeta?: {
    readonly backgroundColor?: { r: number; g: number; b: number; a: number };
    readonly thumbnailSize?: { width: number; height: number };
    readonly renderCoordinates?: { x: number; y: number; width: number; height: number };
  };
  readonly fileName?: string;
  readonly developerRelatedLinks?: readonly string[];
  readonly exportedAt?: string;
};

function parseClientMeta(raw: Record<string, unknown>): FigPackageMetadata["clientMeta"] | undefined {
  const clientMeta = raw.client_meta as Record<string, unknown> | undefined;
  if (!clientMeta) {
    return undefined;
  }
  return {
    backgroundColor: clientMeta.background_color as FigPackageMetadata["clientMeta"] extends { backgroundColor?: infer T }
      ? T
      : never,
    thumbnailSize: clientMeta.thumbnail_size as FigPackageMetadata["clientMeta"] extends { thumbnailSize?: infer T }
      ? T
      : never,
    renderCoordinates: clientMeta.render_coordinates as FigPackageMetadata["clientMeta"] extends {
      renderCoordinates?: infer T;
    }
      ? T
      : never,
  };
}

/** Parse `meta.json` from a fig-family ZIP package. */
export function parseFigPackageMetadata(content: string): FigPackageMetadata | null {
  try {
    const raw = JSON.parse(content) as Record<string, unknown>;
    return {
      raw,
      rawKeys: Object.keys(raw).sort(),
      clientMeta: parseClientMeta(raw),
      fileName: raw.file_name as string | undefined,
      developerRelatedLinks: raw.developer_related_links as readonly string[] | undefined,
      exportedAt: raw.exported_at as string | undefined,
    };
  } catch (error: unknown) {
    void error;
    return null;
  }
}

function buildClientMeta(clientMeta: FigPackageMetadata["clientMeta"]): Record<string, unknown> | undefined {
  if (!clientMeta) {
    return undefined;
  }
  return {
    background_color: clientMeta.backgroundColor,
    thumbnail_size: clientMeta.thumbnailSize,
    render_coordinates: clientMeta.renderCoordinates,
  };
}

/** Build the JSON object written as `meta.json` in a fig-family ZIP package. */
export function buildFigPackageMetadataJson(metadata: Partial<FigPackageMetadata>): Record<string, unknown> {
  return {
    ...metadata.raw,
    client_meta: buildClientMeta(metadata.clientMeta),
    file_name: metadata.fileName,
    developer_related_links: metadata.developerRelatedLinks ?? [],
    exported_at: metadata.exportedAt ?? new Date().toISOString(),
  };
}
