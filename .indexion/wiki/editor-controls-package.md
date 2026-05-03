# @higma/editor-controls

エディターUIコントロール: レイアウト、ズーム、フォント選択、インスペクター。

## フォーマットアダプター

FormattingAdapter でフォーマットアダプターを表現します。

## 混合状態

MixedContext で混合コンテキスト、isMixedField で混合フィールド判定を行います。

## テキストエディター

TextFormattingEditor, TextFormattingEditorProps でテキストフォーマットエディターを提供します。

ParagraphFormattingEditor, ParagraphFormattingEditorProps で段落フォーマットエディターを提供します。

TextFormatting, TextFormattingFeatures でテキストフォーマット、HorizontalAlignment で水平配置を表現します。

ParagraphFormatting, ParagraphFormattingFeatures で段落フォーマットを表現します。

AlignmentValue で配置値を表現します。

## テーブルエディター

TableStyleBandsEditor, TableStyleBandsEditorProps でテーブルスタイルバンドエディターを提供します。

TableStyleBands, TableBandFeatures, BandKey でテーブルスタイルを管理します。

TableCellGridProps でセルグリッドプロパティ、TableStructureToolbarProps で構造ツールバープロパティを指定します。

## フォント

FontFamilySelect, FontFamilySelectProps でフォントファミリー選択を提供します。

useDocumentFontFamilies でドキュメントフォントファミリー取得を行います。

UseLocalFontsResult でローカルフォント結果、LocalFontsStatus でステータスを表現します。

FontFaceSetHandler でフォントフェイスセットハンドラー、HandlerSnapshot でスナップショットを管理します。

Multiplexer でマルチプレクサー、getFontFamilies でファミリー取得、areSameStringArray で配列比較、normalizeFamilyName でファミリー名正規化、subscribeToFontChanges で変更購読を行います。

## ズームコントロール

ZoomControls でズームコントロールを提供します。

ZoomMode, ZoomControlsProps でズーム設定を指定します。

ZOOM_STEPS でステップ、FIT_ZOOM_VALUE でフィット値を定義します。

getClosestZoomIndex で最近接インデックス取得、getNextZoomValue で次の値取得、getZoomOptions でオプション取得、isFitMode でフィットモード判定を行います。

## エディターシェル

EditorShell でエディターシェル、CanvasArea でキャンバスエリアを提供します。

EditorLayoutMode, EditorLayoutBreakpoints でレイアウトモード、EditorPanel でパネル、EditorShellProps でプロパティを指定します。

EditorShellSchema, EditorShellSchemaInput でスキーマを管理します。

resolveEditorLayoutMode でモード解決、DEFAULT_EDITOR_LAYOUT_BREAKPOINTS でデフォルトブレークポイントを定義します。

useContainerWidth でコンテナ幅取得、editorContainerStyle でコンテナスタイル、toolbarStyle でツールバースタイル、gridContainerStyle でグリッドコンテナスタイルを取得します。

CanvasAreaProps でキャンバスエリアプロパティを指定します。

## レイアウト配置

gridPlacement でグリッド配置、LayerPlacement でレイヤー配置を管理します。

drawerPlacement でドロワー配置、DrawerPlacementOptions でオプションを指定します。

resolveMobile, resolveTablet, resolveDesktop で各デバイス解決を行います。

resolveMobileLeftPlacement, resolveMobileRightPlacement, resolveTabletRightPlacement で配置解決を行います。

## UIコンポーネント

OptionalPropertySection, OptionalPropertySectionProps でオプショナルプロパティセクションを提供します。

resolveStyle でスタイル解決、createOnChange で変更ハンドラー作成、resolveAddGroupStyle でグループスタイル解決を行います。

## キャンバス選択コンポーネント

SelectionBox, SelectionBoxProps で選択ボックス、SelectionBoxVariant でバリアントを提供します。

CanvasResizeHandle, CanvasResizeHandleProps でリサイズハンドル、CanvasRotateHandle, CanvasRotateHandleProps で回転ハンドルを提供します。

## インスペクターコンポーネント

BoundingBoxOverlay, BoundingBoxOverlayProps でバウンディングボックスオーバーレイを提供します。

InspectorTreePanel, InspectorTreePanelProps でインスペクターツリーパネル、TreeNodeInternalProps で内部プロパティを管理します。

CategoryLegend, CategoryLegendProps でカテゴリ凡例を提供します。

NodeTooltip, NodeTooltipProps でノードツールチップを提供します。

InspectorCanvasOverlay, InspectorCanvasOverlayProps でキャンバスオーバーレイを提供します。

InspectorTab でインスペクタータブ、InspectorPanelWithTabsProps でタブパネルプロパティを指定します。

findAncestorIds で祖先ID検索、collectInitialExpanded で初期展開収集を行います。

## エディターグリッド

EditorGridConfigOptions でグリッド設定オプションを指定します。

## ページサイズ

PageSizeEditorProps でページサイズエディタープロパティを指定します。

## テキスト合成

UseTextCompositionArgs で引数、UseTextCompositionResult で結果を表現します。

## 範囲

Extents で範囲、updateExtentsFromBounds で境界から更新を行います。

## リボン

RibbonMenuProps でリボンメニュープロパティ、RibbonGroupProps でグループプロパティを指定します。

## Undo/Redo

UndoRedoGroupProps でUndoRedoグループプロパティを指定します。

## カスタマイズ

CustomizeSheetProps でカスタマイズシートプロパティを指定します。

## スライド

SlideCanvasBackgroundParams でスライドキャンバス背景パラメータを指定します。

## サムネイル

ThumbnailContainerStyleOptions でサムネイルコンテナスタイルオプションを指定します。

## See Also

- wiki://fig-editor-package — このパッケージを使用するエディター
- wiki://ui-components-package — 基本UIコンポーネント
