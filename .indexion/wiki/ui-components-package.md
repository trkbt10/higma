# @higuma/ui-components

共有UIコンポーネントライブラリ。

## 型

EditorProps, EditorState, EditorAction でエディターを表現します。

InputType で入力タイプ、ButtonVariant でボタンバリアント、SelectOption で選択オプションを表現します。

## デザイントークン

tokens でトークン全体、colorTokens で色、radiusTokens で半径、spacingTokens で間隔、fontTokens でフォント、iconTokens でアイコン、shadowTokens で影を取得します。

Tokens, ColorTokens, RadiusTokens, SpacingTokens, FontTokens, IconTokens, ShadowTokens で型を表現します。

FontTokens, IconTokens, RadiusTokens, ShadowTokens, SpacingTokens, FieldLabelTokens, EditorShellTokens, FieldContainerTokens でトークン設定を管理します。

injectCSSVariables で注入、removeCSSVariables で削除、generateCSSVariables で生成、cssVar で変数取得、CSS_VAR_MAP でマップを参照します。

## アイコン

AddIcon, ArrowRightIcon, AlignBottomIcon, AlignCenterIcon, AlignJustifyIcon, AlignLeftIcon, AlignMiddleIcon, AlignRightIcon, AlignTopIcon でアイコンを提供します。

ArrowDownIcon, ArrowUpIcon, AudioIcon, BoldIcon, BringForwardIcon, BringToFrontIcon でアイコンを提供します。

ChartIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, CloseIcon でアイコンを提供します。

ConnectorIcon, CopyIcon, CutIcon, DeleteIcon, DiagramIcon, DiamondIcon, DownloadIcon, EditIcon でアイコンを提供します。

EllipseIcon, EnterFullscreenIcon, ExitFullscreenIcon, FileIcon, FolderIcon, FxIcon, GridIcon, GroupIcon でアイコンを提供します。

HiddenIcon, ImageIcon, ItalicIcon, LeftArrowIcon, LineIcon, ListViewIcon, LoaderIcon, LockIcon でアイコンを提供します。

MergeCellsIcon, MoreIcon, OleObjectIcon, PasteIcon, PauseIcon, PenIcon, PencilIcon, PictureIcon でアイコンを提供します。

PlayIcon, RectIcon, RedoIcon, ReplaceIcon, ReplaceAllIcon, RightArrowIcon, RotateCcwIcon, RoundRectIcon でアイコンを提供します。

SelectIcon, SendBackwardIcon, SendToBackIcon, SettingsIcon, ShareIcon, ShieldIcon, SidebarIcon でアイコンを提供します。

SkipBackIcon, SkipForwardIcon, StarIcon, StopIcon, TableIcon, TextBoxIcon, TileViewIcon, TrashIcon, ClearIcon, SearchIcon でアイコンを提供します。

TriangleIcon, UnderlineIcon, UndoIcon, UngroupIcon, UnlockIcon, UnknownShapeIcon, UnmergeCellsIcon, UploadIcon, VideoIcon, VisibleIcon でアイコンを提供します。

IconComponent でアイコンコンポーネント型を表現します。

## プリミティブ

Button, ButtonProps, ButtonSize でボタンを提供します。

IconButton, IconButtonProps, IconButtonSize でアイコンボタンを提供します。

Input, InputProps で入力を提供します。

Popover, PopoverProps でポップオーバーを提供します。

Select, SelectProps で選択を提供します。

SearchableSelect, SearchableSelectProps, SearchableSelectOption, SearchableSelectItemProps で検索可能選択を提供します。

Slider, SliderProps でスライダーを提供します。

Tabs, TabsProps, TabItem, BasicTabs, TabsWithDisabled, InteractiveTabs でタブを提供します。

ToggleButton, ToggleButtonProps でトグルボタン、Toggle, ToggleProps でトグルを提供します。

CursorCaret, CursorCaretProps でカーソルキャレットを提供します。

ToolbarButton, ToolbarButtonProps, ToolbarButtonSize, TOOLBAR_BUTTON_ICON_SIZE でツールバーボタンを提供します。

ToolbarSeparator, ToolbarSeparatorProps でツールバーセパレーターを提供します。

## フック

useCursorBlink でカーソル点滅を使用します。

## スクロール/仮想化

VirtualScroll, VirtualScrollProps で仮想スクロールを提供します。

useVirtualScroll, useVirtualScrollContext で仮想スクロールフックを使用します。

UseVirtualScrollOptions, UseVirtualScrollReturn で型を表現します。

ViewportRect でビューポート矩形を表現します。

## コンテキストメニュー

ContextMenu, ContextMenuProps でコンテキストメニューを提供します。

ContextMenuItem, ContextMenuItemProps でアイテム、ContextMenuSeparator でセパレーター、ContextMenuSubmenu, ContextMenuSubmenuProps でサブメニューを提供します。

MenuItemId, MenuItem, MenuSubmenu, MenuSeparator, MenuEntry でメニュー型を表現します。

isSeparator, isSubmenu, isMenuItem で判定を行います。

DefaultSeparator でデフォルトセパレーターを提供します。

## ポップオーバー位置

clamp でクランプ、canFit でフィット判定、CanFitInput, ClampRangeInput で入力を表現します。

PopoverSide で辺、PopoverSize でサイズ、PopoverAlign で配置、PopoverViewport でビューポートを表現します。

resolveSide で辺解決、getOppositeSide で反対辺取得、getAvailableSpaces で利用可能スペース取得を行います。

getAlignedTop で上配置、getAlignedLeft で左配置を取得します。

AlignedPositionInput, PopoverPositionInput, PopoverPositionResult で位置計算を表現します。

AdjustPositionInput, AdjustVerticalInput, AdjustHorizontalInput で調整入力を表現します。

getAdjustedPosition, getAdjustedVerticalPosition, getAdjustedHorizontalPosition で調整位置を取得します。

## グリッド

clampRange でレンジクランプ、computePrefixSums でプレフィックスサム計算、findIndexAtOffset でオフセット検索を行います。

## レイアウト

FieldGroup, FieldGroupProps でフィールドグループを提供します。

FieldRow, FieldRowProps でフィールド行を提供します。

Panel, PanelProps でパネルを提供します。

Section, SectionProps でセクションを提供します。

## グループリスト

GroupedList, GroupedListProps でグループリストを提供します。

GroupedListItem, GroupedListItemProps でアイテム、GroupedListGroup, GroupedListGroupProps でグループを提供します。

GroupedListContextMenu, GroupedListContextMenuProps でコンテキストメニューを提供します。

GroupedListItemId, GroupedListGroupId でID型、GroupedListItemData, GroupedListGroupData でデータ型を表現します。

GroupedListSelectionState で選択状態、GroupedListContextMenuState でコンテキストメニュー状態、GroupedListEditState で編集状態、GroupedListDragState でドラッグ状態を表現します。

DropTargetPosition でドロップターゲット位置、CollapsedGroupsState で折りたたみ状態を表現します。

GroupedListMode でモード、GroupedListActionId でアクションID、GroupedListMenuContext でメニューコンテキストを表現します。

createEmptySelection, createSingleSelection, createClosedContextMenu, createIdleEditState, createIdleDragState で初期状態作成を行います。

GROUPED_LIST_ACTIONS でアクション定義を参照します。

useGroupedListContextMenu, UseGroupedListContextMenuReturn でコンテキストメニューフックを使用します。

useGroupedListKeyboard, UseGroupedListKeyboardOptions でキーボードフックを使用します。

useGroupedListDragDrop, UseGroupedListDragDropOptions, UseGroupedListDragDropReturn でドラッグドロップフックを使用します。

## プレイヤー

Player, PlayerProps でプレイヤーを提供します。

PlayerControls, PlayerControlsProps でコントロール、PlayerDisplay, PlayerDisplayProps でディスプレイを提供します。

PlayerState で状態、PlayerMedia でメディア、PlayerAction でアクション、PlayerError でエラー、PlayerVariant でバリアント、MainButtonMode でボタンモードを表現します。

PLAY_BUTTON_SIZE, ACTION_BUTTON_SIZE, PLAY_ICON_SIZE, ACTION_ICON_SIZE でサイズ定数を定義します。

## エディター

Breadcrumb, BreadcrumbProps でパンくず、BreadcrumbItem でアイテムを提供します。

ConsolePanel, ConsolePanelProps でコンソールパネル、ConsoleMessage, ConsoleMessageType でメッセージを表現します。

EditorLayout, EditorLayoutProps でエディターレイアウトを提供します。

EditorStatusBar, EditorStatusBarProps でステータスバー、CursorPosition でカーソル位置を提供します。

FilterInput, FilterInputProps でフィルター入力を提供します。

NavigatorTabs, NavigatorTabsProps でナビゲータータブ、NavigatorTab, InteractiveNav でタブを提供します。

formatTimestamp でタイムスタンプフォーマットを行います。

## スライダー

getThumbStyle でサムスタイル、getTrackStyle でトラックスタイル、getThumbBackgroundColor でサム背景色、getTrackBackgroundColor でトラック背景色を取得します。

SliderWithSuffix, SliderWithoutValue でスライダーバリアントを提供します。

InteractiveSlider でインタラクティブスライダーを提供します。

## トグル

InteractiveToggle でインタラクティブトグルを提供します。

## 入力

InteractiveInput, InteractiveProps でインタラクティブ入力を提供します。

TextInputDemo, NumberInputDemo でデモを提供します。

## リサイズ

ResizeDirection でリサイズ方向を表現します。

## スクロールバー

ScrollbarProps でスクロールバープロパティを指定します。

## サイドバー

SidebarProps でサイドバープロパティを指定します。

## コントロール

ControlsProps でコントロールプロパティ、renderControl でレンダリングを行います。

## ナビゲーション

NavigationControlsVariant でナビゲーションコントロールバリアントを表現します。

## 位置インジケーター

PositionIndicatorVariant で位置インジケーターバリアントを表現します。

## その他

TestMeta でテストメタ、Debugger でデバッガー、SettingsExample で設定例を提供します。

updateUrl でURL更新を行います。

findBackdrop でバックドロップ検索、isWheelEvent でホイールイベント判定を行います。

getInitialSelection で初期選択取得、stubBoundingClientRect でスタブ矩形、createResizeObserverEntry でオブザーバーエントリー作成を行います。

## See Also

- wiki://editor-controls-package — 高レベルエディターコントロール
