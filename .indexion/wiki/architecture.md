# Architecture

## レイヤードアーキテクチャ

```
Layer 4: アプリケーション
├── fig-editor (ビジュアルエディター)

Layer 3: UI & コントロール
├── editor-controls (EditorShell, ZoomControls, FontSelect)
├── editor-core (history, selection, drag-state, geometry)
├── ui-components (Button, Input, Panel, ContextMenu)

Layer 2: レンダリング
├── fig-renderer (SVGレンダリング)

Layer 1: ドメイン
├── fig-builder (FigDesignDocument, CRUD, export)
├── fig (parseFigFile, Kiwi codec, tree-builder)

Layer 0: インフラ
├── buffer (base64, DataURL)
├── png (encodeRgbaToPng, parsePng)
├── zip (loadZipPackage)
```

## パッケージ依存関係

```
fig-editor
├── fig-renderer
│   └── fig
├── fig-builder
│   └── fig
├── editor-controls
│   ├── editor-core
│   └── ui-components
└── ui-components

fig-builder
└── fig

fig-renderer
└── fig

png
└── buffer

zip (fflate使用、独立)
buffer (独立)
```

## 主要な設計判断

### 関数ベースAPI

クラスベースではなく、純粋関数ベースのAPIを採用:

```typescript
// 正しい使い方
import { createHistory, pushHistory, undoHistory } from "@higuma/editor-core";
let history = createHistory(initialState);
history = pushHistory(history, newState);
history = undoHistory(history);
```

### 明示的な依存性

「No Magic Policy」に従い、全ての依存は明示的。環境変数や暗黙の設定なし。

### コロケーションテスト

ユニットテスト (`*.spec.ts`) は実装と同じ場所に配置。統合テストは `spec/` に配置。

## 拡張ポイント

### フォントローダーDI

フォントローダーは依存性注入で環境非依存:

```typescript
import { font } from "@higuma/fig-renderer";

// Node.js環境
const loader = font.createNodeFontLoader();

// カスタムディレクトリ
const loader = font.createNodeFontLoader({
  fontDirs: ["./assets/fonts"],
});

// キャッシュ付き
const cachingLoader = new font.CachingFontLoader(loader);
```

## See Also

- wiki://overview — プロジェクト概要
- wiki://core-concepts — 主要概念
