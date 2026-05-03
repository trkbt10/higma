# @higma/fig

Figma .fig ファイルのパース、Kiwiスキーマのエンコード/デコード、ツリー操作を行うコアパッケージ。

## パーサー機能

このパッケージは parseFigFile と parseFigFileSync でファイルをパースします。parseFigHeader でヘッダーのみを高速に解析でき、isFigFile でマジック判定、isFigmaZipFile でZIP形式判定を行います。

解凍には decompress, decompressZstd, decompressDeflate, decompressDeflateRaw を使用します。

## ツリー操作

buildNodeTree で NodeChanges をツリー構造に変換します。findNodesByType でタイプ検索、findNodeByGuid でGUID検索、getNodeType でノードタイプ取得、safeChildren で子ノード取得が可能です。

guidToString と parseGuidString でGUID変換を行います。

## Blob解析

decodeBlobToSvgPath でBlobをSVGパス文字列に変換、decodePathCommands でパスコマンド配列に変換します。

## 型定義

FigNodeType, FigMatrix, FigColor, FigGuid などの型を提供します。

NodeType, BlendMode, PaintType, EffectType, StrokeCap, StrokeJoin, StrokeAlign, WindingRule などの列挙型があります。

ノードデータ型として FrameNodeData, RectangleNodeData, EllipseNodeData, TextNodeData, VectorNodeData, LineNodeData, StarNodeData, PolygonNodeData, GroupNodeData, SectionNodeData, InstanceNodeData, SymbolNodeData があります。

エフェクト関連で EffectData, BaseEffectData, BlurEffectData, ShadowEffectData を提供します。

ペイント関連で ImagePaint, GradientStop, GradientHandles, solidPaint, solidStroke があります。

## バリデーション

ValidationError, ValidationResult で検証結果を表現し、FigParseError でパースエラーを表現します。

## ビルダー状態

FrameBuilderState, TextBuilderState, StrokeBuilderState, SymbolBuilderState, InstanceBuilderState でビルダー状態を管理します。

DropShadowBuilderState, InnerShadowBuilderState でシャドウ、SolidPaintBuilderState, ImagePaintBuilderState, LinearGradientBuilderState, RadialGradientBuilderState, AngularGradientBuilderState, DiamondGradientBuilderState でペイントを構築します。

## テキスト関連

TextCase, TextDecoration, TextAutoResize, TextAlignVertical, TextAlignHorizontal, NumberUnits, ValueWithUnits を提供します。

## レイアウト関連

StackMode, StackAlign, StackSizing, StackPositioning, StackPadding, ConstraintType を提供します。

## その他

ByteBuffer でバッファ操作、encodeFloat32LE でエンコード、readVarUint で可変長整数読み取り、compareBytes でバイト比較を行います。

isKiwiEnumValue, getTypeName, isZstd, isZipFile, getCompressionType などのユーティリティがあります。

## See Also

- wiki://core-concepts — ファイルフォーマットの詳細
- wiki://fig-builder-package — 高レベルAPI
- wiki://fig-renderer-package — レンダリング
