/**
 * @file Tests for fig-family package metadata
 */

import { buildFigPackageMetadataJson, parseFigPackageMetadata } from "./metadata";

describe("fig package metadata", () => {
  it("maps wire JSON names to domain names", () => {
    const metadata = parseFigPackageMetadata(JSON.stringify({
      client_meta: {
        background_color: { r: 1, g: 1, b: 1, a: 1 },
        thumbnail_size: { width: 320, height: 180 },
        render_coordinates: { x: 0, y: 0, width: 640, height: 360 },
      },
      file_name: "Example",
      developer_related_links: [],
      exported_at: "2000-01-01T00:00:00.000Z",
    }));

    expect(metadata?.clientMeta?.renderCoordinates?.width).toBe(640);
    expect(metadata?.fileName).toBe("Example");
  });

  it("builds wire JSON names from domain names", () => {
    expect(buildFigPackageMetadataJson({
      fileName: "Example",
      clientMeta: {
        thumbnailSize: { width: 320, height: 180 },
      },
    })).toMatchObject({
      file_name: "Example",
      client_meta: {
        thumbnail_size: { width: 320, height: 180 },
      },
    });
  });
});
