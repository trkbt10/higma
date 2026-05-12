<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../brand/higma-dark.svg" />
    <img src="../../brand/higma.svg" alt="higma logo" width="180" />
  </picture>
</p>

<h1 align="center">higma</h1>

higma は Figma の `.fig` ファイルをパース、レンダリング、編集するためのTypeScriptモノレポです。

## プロジェクトの目的

- **パース** — `.fig` バイナリファイルをTypeScriptオブジェクトとして解析
- **レンダリング** — Figmaドキュメントを**SVG**としてレンダリング
- **編集** — React ベースのビジュアルエディターでドキュメントを編集
- **ビルド** — `FigDesignDocument` モデルでプログラム的にドキュメントを構築

## アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────────┐
│                        fig-editor                               │
│              (React ベースビジュアルエディター)                  │
│   FigEditor, FigEditorProvider, useFigEditor                    │
├─────────────────────────────────────────────────────────────────┤
│    editor-controls    │    editor-core    │    ui-components    │
│  (EditorShell, Zoom)  │ (history, selection)│ (Button, Input)   │
├───────────────────────┴───────────────────┴─────────────────────┤
│                       fig-renderer                              │
│              (SVGレンダリング - FigSvgRenderContext)            │
├─────────────────────────────────────────────────────────────────┤
│                        fig-builder                              │
│     (FigDesignDocument モデル、addNode, removeNode, exportFig)  │
├─────────────────────────────────────────────────────────────────┤
│                            fig                                  │
│   (コアドメイン: parseFigFile, Kiwi codec, tree-builder)        │
├──────────────────────┬──────────────────────┬───────────────────┤
│        buffer        │         png          │        zip        │
│   (base64, DataURL)  │  (encodeRgbaToPng)   │  (loadZipPackage) │
└──────────────────────┴──────────────────────┴───────────────────┘
```

## パッケージ概要

| パッケージ | 用途 |
|---------|---------|
| wiki://fig-package | コアドメイン: `parseFigFile`, Kiwiスキーマ, ツリー操作 |
| wiki://fig-builder-package | `FigDesignDocument` モデル、CRUD操作、エクスポート |
| wiki://fig-renderer-package | SVGレンダリングエンジン |
| wiki://fig-editor-package | Reactベースビジュアルエディター |
| wiki://editor-controls-package | EditorShell、Zoom、フォント選択 |
| wiki://editor-core-package | 選択、履歴、ドラッグ、ジオメトリ |
| wiki://ui-components-package | 共通UIコンポーネント |
| wiki://buffer-package | Base64、DataURL変換 |
| wiki://png-package | PNGエンコード/デコード |
| wiki://zip-package | ZIPファイル操作 |

## See Also

- wiki://getting-started — インストールとセットアップ
- wiki://core-concepts — 主要な抽象概念
- wiki://architecture — 詳細アーキテクチャ
