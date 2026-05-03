# @higma/fig-editor

Figmaドキュメント用のReactベースビジュアルエディター。

## エディターコンポーネント

FigEditor がメインエディター、FigEditorCanvas がキャンバス、FigPageRenderer でページレンダリング、FigEditorToolbar でツールバーを提供します。

FigEditorRendererKind でレンダラー種別を指定します。

## コンテキストとフック

FigEditorProvider でコンテキスト提供、useFigEditor, useFigEditorOptional でコンテキスト取得、useFigDrag でドラッグ状態を取得します。

useExportFig でエクスポート、useFigFileLoad でファイル読み込みを行います。

FigEditorContextValue, FigEditorProviderProps でコンテキストを表現します。

## 状態管理

FigEditorState, FigEditorAction で状態とアクションを表現します。

FigCreationMode でクリエーションモード、createSelectMode, isSelectMode で選択モードを管理します。

FigTextEditState でテキスト編集状態、FigClipboardContent でクリップボードを表現します。

figEditorReducer でリデューサー、createFigEditorState で初期状態を作成します。

## パネル

PropertyPanel でプロパティ、PageListPanel でページ一覧、LayerPanel でレイヤーを表示します。

FigInspectorPanel, FigInspectorPanelProps でインスペクター、FigInspectorDetailsPanel, FigInspectorDetailsPanelProps, DetailSectionRenderer, FIG_DETAIL_SECTIONS, DetailSection, DetailRow, DetailSwatch で詳細セクションを管理します。

## インスペクター

FIG_NODE_CATEGORY_REGISTRY, FIG_LEGEND_ORDER でカテゴリ登録を行います。

getRootNormalizationTransform で変換取得、collectFigBoxes, collectDesignBoxes でボックス収集、figNodeToInspectorTree, designNodeToInspectorTree でツリー変換を行います。

FigInspectorOverlay, FigInspectorOverlayProps でオーバーレイ、FigInspectorProvider, useFigInspectorContextOptional でコンテキストを提供します。

## キャンバス操作

CanvasTargetMode, CanvasTargetBounds でターゲット、CanvasInteractionPolicy でポリシーを管理します。

syncCanvasCssSize でサイズ同期、countCanvasHitAreas でヒットエリア、countSelectionRects で選択矩形を数えます。

focusCanvasTextarea, getCanvasTextareaValue, canvasTextareaSelection でテキストエリアを操作、isCanvasTextEditActive でテキスト編集判定を行います。

## ノード操作

NodeSpec でノード仕様、nodeId でノードID、getNodeParentId で親ID取得を行います。

NodeBounds でノード境界、nodeScreenRect, nodeScreenPoint でスクリーン座標を取得します。

pointToLocal で座標変換、findAbsoluteBounds で絶対境界、computeGroupBounds でグループ境界、computeCombinedBounds で結合境界、computeAbsoluteNodeBoundsInner で内部境界を計算します。

clickNode, clickNodeAt, clickNodeAtPagePosition, clickPagePoint でクリック、shiftClickNode でシフトクリック、doubleClickNode でダブルクリックを行います。

topmostAt で最上位ノード取得、buildNodeSelection で選択構築を行います。

## ベクターパス

VectorPathDraft でドラフト、VectorPathPoint でポイント、VectorPathBounds で境界、VectorPathHandle でハンドル、VectorPathDragState でドラッグ状態を管理します。

VectorPathControlLine でコントロールライン、VectorPathSegmentLine でセグメントラインを表現します。

canEnterVectorPathEdit で編集可能判定、findNearestVectorHandle で最近接ハンドル検索を行います。

EditableVectorPathSource, EditableVectorPathOverlay, EditableVectorPathOperation でパス編集を管理します。

collectVectorPathHandles でハンドル収集、collectVectorPathControlLines でコントロールライン収集、collectEditableVectorPathOverlays でオーバーレイ収集を行います。

resolveContextVectorHandle, resolveEditableVectorPaths で解決を行います。

## ベクターパスドラフト

VectorPathDraftHandle でハンドル、VectorPathDraftParent で親、VectorPathDraftSegment でセグメント、VectorPathDraftSession でセッションを管理します。

VectorPathDraftOperation, VectorPathDraftOperationResult で操作を表現します。

VectorPathDraftControlLine, VectorPathDraftLineSegment, VectorPathDraftCubicSegment でラインを管理します。

VectorPathDraftHandleIntent で意図、VectorPathDraftPointerStart でポインター開始を表現します。

draftControlLineCount, draftAnchorHandleCount, draftControlHandleCount でカウント、draftAnchorHandleCenter, draftControlHandleCenter で中心、draftSegmentStrokeWidth, draftControlLineStrokeWidth で太さを取得します。

## パス編集

EditableCommand, EditableCommandType でコマンド、EditablePathPoint でポイント、EditablePathCommand でパスコマンドを管理します。

firstEditablePathData でデータ取得、editablePathScreenPoint でスクリーン座標を取得します。

EditableAutoLayout でオートレイアウト、EditableInsertionTarget で挿入ターゲットを管理します。

## ハンドル操作

controlLineCount, anchorHandleCount, vectorHandleCount でカウント、anchorHandleCenter, controlHandleCenter, firstAnchorHandleCenter で中心を取得します。

rightClickAnchorHandle で右クリック、handleCenterByAriaLabelPrefix でラベル検索、nearestAnchorHandleDistance で距離計算を行います。

## テキスト

countCarets でキャレット数、countTextEditFrameOutlines でアウトライン数を取得します。

LetterSpacing で文字間隔、mergeLetterSpacing でマージ、mergeLineHeight で行高マージを行います。

textNodeFontOptions, collectTextFontOptions, collectTextFontOptionsFromNode でフォントオプションを取得します。

FigTextAutoResize でオートリサイズを管理します。

## ペイント操作

PaintListKind でリスト種別、PaintOperation, PaintListOperation でペイント操作、EffectOperation, EffectListOperation でエフェクト操作を管理します。

getPaintColor で色取得、getPaintOpacity で透明度取得を行います。

AppearanceOperation で外観操作、applyAppearanceOperation で適用を行います。

PaintEditorConfig でエディター設定、resolveStrokeWeightAfterPaintOperation でストローク幅解決を行います。

## エクスポート

ExportFormat でフォーマット、FigDownloadUrl でURL、FigDownloadAnchor でアンカー、FigDownloadDocument でドキュメントを管理します。

DownloadEnvironment で環境、stripFigExtension で拡張子削除、sanitizeFilenameBase でサニタイズを行います。

isInvalidFilenameCharacter で無効文字判定、removeInvalidFilenameCharacters で削除、replaceInvalidFilenameCharacter で置換を行います。

resolveExportFormat でフォーマット解決、resolveExportScale でスケール解決、makeExportImageType でイメージタイプ作成、resolveImageExtension で拡張子解決を行います。

UseExportFigResult, UseFigFileLoadResult で結果を表現、UseFigSceneGraphParams でパラメータを指定します。

createDefaultExportSetting でデフォルト設定作成を行います。

## ドラッグ

FigDragContextValue でドラッグコンテキスト、FigUserIntent, FigUserIntentKind でユーザー意図、FigUserOperation, FigUserOperationDomain で操作を管理します。

ApplyDragOptions でオプション、applyDragToDocument でドキュメント適用を行います。

ResolveFigUserIntentOptions, ResolveCanvasInteractionTargetOptions で解決オプションを指定します。

## コンポーネント

makeComponent でコンポーネント作成、makeComponentSet でセット作成、makeInstance でインスタンス作成を行います。

findVariantSpec でバリアント検索、updateVariantSpec で更新、updateVariantDefName で名前更新を行います。

## レイヤー

LayerNodeBadge でバッジ、LayerNodePresentation でプレゼンテーションを管理、getStandaloneBadge でスタンドアロンバッジ、getStandaloneRowStyle でスタイルを取得します。

## ユーティリティ

makeNode, makeFrame, makeSection, makeVector, makeVectorNode, makeTextNode, makeRectangle, makeDocument でノード作成を行います。

makePath, linePath, rectPath, ellipsePath, roundedRectPath でパス作成を行います。

makeKiwiEnum, enumName, kiwiName, windingName で列挙作成を行います。

makeTransform, _makeRotatedTransform で変換作成、BuildRotatedTransformOptions, BuildRotatedTransformAtWorldCenterOptions でオプションを指定します。

getSiblingList, replaceSiblingList で兄弟リスト操作、flattenRecursive でフラット化を行います。

supportsOutline でアウトラインサポート判定、resolveAllowedOperations で許可操作解決を行います。

selectionBoxPageBounds で選択ボックス境界、CornerRadiusIndex でコーナー半径インデックスを管理します。

PropertyMutationTarget で変更ターゲット、BuildNodeSpecFromCreationModeOptions でビルドオプションを指定します。

## ファイル操作

FileDropZone でドロップゾーン、renderDropZoneContent でコンテンツレンダリング、resolveDropZoneStateStyle でスタイル解決を行います。

rejectFilesMatching でファイル拒否、requireExactDirectories, requireAllowedDirectFiles で検証を行います。

## テスト

DevMode でDevモード、openEditor, waitForEditor でエディター操作を行います。

TestNodeOptions, TestDesignNodeOverrides でテストオプション、createTestDesignNode でテストノード作成を行います。

renderedSvgMarkup でSVGマークアップ取得、renderSceneAsync でシーンレンダリングを行います。

pagePointToScreenPoint でスクリーン座標変換、activeElementDiagnostics で診断を行います。

committedPathUnitSummary, committedVectorPathStrokeCount でコミット済み情報を取得します。

svgToDataUrl, hashBytes でユーティリティ、ItemBounds でアイテム境界を表現します。

fontKey, createBadge でバッジ作成、normalizeStyle でスタイル正規化を行います。

formatEffectLabel, getEffectTypeName でエフェクトラベルを取得します。

makeScaleConstraint でスケール制約作成を行います。

VectorPathSectionProps でセクションプロパティ、UseFigTextFontResolverParams でリゾルバーパラメータを指定します。

CreateFigImageAssetParams で画像アセットパラメータを指定します。

## See Also

- wiki://fig-renderer-package — レンダリングエンジン
- wiki://editor-controls-package — UIコントロール
- wiki://editor-core-package — エディタープリミティブ
