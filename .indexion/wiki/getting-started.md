# Getting Started

## Prerequisites

- **Bun** v1.3.13+ (パッケージマネージャー兼ランタイム)
- **Node.js** v18+ (一部の依存関係用)

## インストール

```bash
git clone <repository-url>
cd higuma
bun install
```

## 利用可能なスクリプト

| コマンド | 説明 |
|---------|------|
| `bun run lint` | 全パッケージでESLintを実行 |
| `bun run lint:fix` | 自動修正可能なlint問題を修正 |
| `bun run typecheck` | 全パッケージの型チェック |
| `bun run test` | 全パッケージのテスト実行 |
| `bun run build` | 全パッケージをビルド |
| `bun run dev` | 開発サーバー起動 |

## 基本的な使い方

### .figファイルのパース

```typescript
import { parseFigFile } from "@higuma/fig/parser";

const buffer = await Bun.file("design.fig").arrayBuffer();
const parsed = await parseFigFile(new Uint8Array(buffer));

// ノードツリーを構築
import { buildNodeTree } from "@higuma/fig/parser";
const tree = buildNodeTree(parsed.nodeChanges);
```

### FigDesignDocumentでの操作

```typescript
import { 
  createFigDesignDocument, 
  addNode, 
  exportFig 
} from "@higuma/fig-builder";

// ドキュメント作成
const doc = createFigDesignDocument();

// ノード追加
const updated = addNode(doc, pageId, nodeSpec);

// .figファイルにエクスポート
const figData = await exportFig(updated);
```

### SVGレンダリング

```typescript
import { FigSvgRenderContext } from "@higuma/fig-renderer";
// SVGレンダリングコンテキストを使用
```

## 開発ワークフロー

1. 混乱したら関連ファイルを読む（推測を避ける）
2. 開発中は lint, typecheck, test を実行
3. ユニットテストは実装と同じ場所に配置 (`[name].spec.ts`)
4. lintルールを厳守: 常にブレースを使用、`&&` を三項演算子として使わない

## See Also

- wiki://overview — プロジェクト概要
- wiki://fig-package — パーサーの詳細
- wiki://fig-builder-package — ドキュメント操作API
