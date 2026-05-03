# @higuma/fig-builder

FigDesignDocument モデルを中心とした高レベルAPI。CRUD操作とエクスポート機能を提供。

## ドキュメント作成

createFigDesignDocument で新規ドキュメント作成、createFigDesignDocumentFromLoaded でパース済みデータから作成、createEmptyFigDesignDocument で空ドキュメントを作成します。

## ページ操作

addPage でページ追加、removePage で削除、reorderPage で並び替え、duplicatePage で複製、renamePage でリネームを行います。

## ノード操作

addNode でノード追加、removeNode で削除、updateNode で更新、reorderNode で並び替え、moveNodeToPage でページ間移動を行います。createNodeFromSpec でスペックからノードを作成します。

AddNodeOptions, UpdateNodeOptions, ReorderNodeOptions, AddNewNodesOptions, MoveNodeToPageOptions, InsertNodeInTreeOptions, FlattenPageOptions でオプションを指定します。

## ノードスペック

NodeSpec, BaseNodeSpec が基本型です。

図形スペックとして LineNodeSpec, RectNodeSpec, StarNodeSpec, VectorNodeSpec, EllipseNodeSpec, PolygonNodeSpec, RoundedRectNodeSpec があります。

ShapeType で図形タイプを指定します。

## エクスポート

exportFig で .fig ファイルにエクスポート、exportFigRoundtrip でラウンドトリップテストを行います。FigExportOptions, FigExportResult で設定と結果を表現します。

## ユーティリティ

guid でGUID生成、nodeIdToGuid でID変換、symbolNode, vectorNode でノード作成、isFigVector で判定を行います。

createFrameNode, createCanvasNode, createIDCounter, createParentIndex, findAllNodes, makeFrameRaw などの内部ユーティリティがあります。

extractSolidColor で色抽出、applyTypeSpecificFields でフィールド適用、componentPropertyValueToFig で変換を行います。

createLoaded でロード済みドキュメント作成を行います。

## See Also

- wiki://fig-package — パーサー
- wiki://fig-editor-package — ビジュアルエディター
