# Core Concepts

## Figファイルフォーマット

Figmaファイルは**Kiwi**と呼ばれるバイナリシリアライゼーション形式を使用します。`.fig`ファイルは実際には**ZIPアーカイブ**です。

### ファイル構造

```
.fig (ZIPアーカイブ)
├── thumbnail.png      # サムネイル（必須）
├── canvas.fig         # メインドキュメントデータ
└── images/            # 埋め込み画像リソース
```

### canvas.fig の構造

```
┌──────────────────────────────────────────┐
│ Header (16 bytes)                        │
│ ├─ Magic: "fig-kiwi"                     │
│ ├─ Version: '0'                          │
│ └─ Payload size                          │
├──────────────────────────────────────────┤
│ Compressed Payload (zstd/deflate)        │
│ ├─ Schema (Kiwiスキーマ定義)             │
│ ├─ NodeChanges (ノードデータ配列)         │
│ └─ Blobs (バイナリデータ: パス、画像等)   │
└──────────────────────────────────────────┘
```

## NodeChanges と Blobs

### NodeChanges

ドキュメント内の各ノード（FRAME, RECTANGLE, TEXT等）は `NodeChanges` 配列に格納されます。

```typescript
// パース結果
const parsed = await parseFigFile(buffer);
parsed.nodeChanges;  // ノードデータの配列
parsed.blobs;        // バイナリBlob配列
```

### Blobs

ジオメトリデータ（パスコマンド）や画像データは `blobs` 配列に格納され、インデックスで参照されます。

```typescript
// ノードのfillGeometryからBlob参照
const fillGeo = node.fillGeometry?.[0];
const blobIndex = fillGeo.commandsBlob;
const blobData = parsed.blobs[blobIndex].bytes;

// BlobをSVGパスに変換
import { decodeBlobToSvgPath } from "@higma/fig/parser";
const pathD = decodeBlobToSvgPath(blobData);
// → "M0,0 L100,0 L100,80 L0,80 L0,0"
```

## ノードタイプ

| カテゴリ | タイプ |
|----------|-------|
| ドキュメント | DOCUMENT, CANVAS |
| コンテナ | FRAME, GROUP, SECTION, COMPONENT, COMPONENT_SET |
| 図形 | RECTANGLE, ELLIPSE, POLYGON, STAR, LINE, VECTOR |
| コンテンツ | TEXT, SLICE, STICKY |
| インスタンス | INSTANCE |

## 座標系

- **原点**: 左上
- **Y軸**: 下向きが正
- **Transform**: 2x3 アフィン行列 (m00, m01, m02, m10, m11, m12)
- **子ノードの座標**: 親に対する相対座標

## レンダリングパイプライン

```
.fig ファイル
    ↓
parseFigFile() [@higma/fig/parser]
    ↓
NodeChanges + Blobs
    ↓
renderFigNode() [@higma/fig-renderer]
    ↓
SVG 文字列
```

## See Also

- wiki://fig-package — パーサーの詳細
- wiki://fig-renderer-package — レンダリングの詳細
