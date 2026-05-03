# @higuma/editor-core

エディタープリミティブ: 選択、履歴、ドラッグ状態、ジオメトリ計算。

## 履歴管理

UndoRedoHistory で履歴を表現します。

createHistory で履歴作成、pushHistory で状態追加、undoHistory でUndo、redoHistory でRedoを行います。

canUndo, canRedo で可能判定、undoCount, redoCount でカウント取得を行います。

clearHistory で履歴クリア、replacePresent で現在状態置換を行います。

## 選択管理

SelectionState で選択状態、SelectionPrimaryFallback でフォールバック、getFallbackPrimaryId でID取得を行います。

createEmptySelection で空選択、createSingleSelection で単一選択、createMultiSelection で複数選択を作成します。

addToSelection で追加、removeFromSelection で削除、toggleSelection でトグルを行います。

isSelected で選択判定、isSelectionEmpty で空判定を行います。

## クリップボード

ClipboardContent でクリップボード内容を表現します。

createClipboardContent で作成、incrementPasteCount でペーストカウント増加、markAsCopy でコピーマーク、markAsCut でカットマークを行います。

## ドラッグ状態

DragState でドラッグ状態を表現します。

IdleDragState でアイドル、MoveDragState で移動、ResizeDragState でリサイズ、RotateDragState で回転、CreateDragState で作成、MarqueeDragState でマーキーを表現します。

PendingMoveDragState, PendingResizeDragState, PendingRotateDragState でペンディング状態を表現します。

PreviewDelta でプレビュー差分を表現します。

createIdleDragState でアイドル作成を行います。

isDragIdle, isDragMove, isDragResize, isDragRotate, isDragCreate, isDragMarquee で状態判定を行います。

isDragPendingMove, isDragPendingResize, isDragPendingRotate, isDragPending でペンディング判定を行います。

## ドラッグユーティリティ

DRAG_THRESHOLD_PX でしきい値、isDragThresholdExceeded で超過判定を行います。

## ポインターユーティリティ

PrimaryMouseEventLike, PrimaryPointerEventLike でイベント型、TextareaSelectionLike でテキストエリア選択を表現します。

isPrimaryMouseAction, isPrimaryPointerAction でプライマリ判定を行います。

applySelectionRange で選択範囲適用、getSelectionAnchor でアンカー取得を行います。

TextSelectionDirection でテキスト選択方向を表現します。

## ジオメトリ型

Point で座標、SimpleBounds で単純境界、RotatedBoundsInput で回転境界入力、RotationResult で回転結果を表現します。

ResizeHandlePosition でリサイズハンドル位置、ResizeBounds でリサイズ境界、ResizeOptions でリサイズオプション、ResizeDimensionsInput でリサイズ次元入力を表現します。

Extents で範囲を表現します。

## 回転

normalizeAngle で角度正規化、degreesToRadians でラジアン変換、radiansToDegrees で度変換を行います。

calculateAngleFromCenter で中心からの角度計算を行います。

DEFAULT_SNAP_ANGLES, DEFAULT_SNAP_THRESHOLD でスナップ設定、snapAngle でスナップを行います。

rotatePointAroundCenter で中心周り回転、calculateShapeCenter で中心計算、getRotatedCorners でコーナー取得を行います。

getSvgRotationTransform, getSvgRotationTransformForBounds でSVG変換を取得します。

rotateShapeAroundCenter で図形回転、calculateRotationDelta で回転差分計算を行います。

## リサイズ

calculateAspectDelta でアスペクト差分、applyMinConstraints で最小制約適用を行います。

resizeFromNW, resizeFromN, resizeFromNE, resizeFromE, resizeFromSE, resizeFromS, resizeFromSW, resizeFromW で各方向リサイズを行います。

calculateResizeBounds でリサイズ境界計算、calculateScaleFactors でスケール係数計算を行います。

calculateRelativePosition で相対位置計算、calculateMultiResizeBounds で複数リサイズ境界計算を行います。

## 境界

getCombinedBoundsWithRotation で回転付き結合境界を取得します。

getPointsForBounds でポイント取得を行います。

## 座標

clientToCanvasCoords でクライアント座標変換を行います。

## ドラッグプレビュー

MoveDragPreviewInput, ResizeDragPreviewInput, RotateDragPreviewInput でプレビュー入力を表現します。

calculateResizedDimensions でリサイズ次元計算を行います。

applyMovePreview で移動プレビュー、applyResizePreview でリサイズプレビュー、applyRotatePreview で回転プレビュー、applyDragPreview でドラッグプレビューを適用します。

## アダプター型

TextStyle でテキストスタイル、FontData でフォントデータ、FontMetricsData でフォントメトリクスを表現します。

CaseTransformData でケース変換、TextJustifyData でテキスト揃え、ParagraphSpacingData で段落間隔を表現します。

IndentData でインデント、ListData でリスト、PositionData で位置、SizeData でサイズを表現します。

## インスペクター型

NodeCategoryConfig, NodeCategoryRegistry でカテゴリ設定を表現します。

AffineTransform でアフィン変換、IDENTITY_TRANSFORM で単位変換を表現します。

InspectorBoxInfo でボックス情報、InspectorTreeNode でツリーノードを表現します。

resolveNodeColor でノード色解決、resolveNodeLabel でノードラベル解決、affineToSvgTransform でSVG変換を行います。

## テスト

DemoDrag でデモドラッグ、TestItem でテストアイテム、createTestItems でテストアイテム作成を行います。

## See Also

- wiki://fig-editor-package — このパッケージを使用するエディター
- wiki://editor-controls-package — UIコントロール
