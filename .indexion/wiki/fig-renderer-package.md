# @higma/fig-renderer

Figmaノードの SVG レンダリングを行うパッケージ。

## レンダリングコンテキスト

FigSvgRenderContext, FigSvgRenderContextConfig, FigSvgRenderResult でSVGレンダリングを管理します。

## ノードレンダリング

renderFrameNode, renderRectNode, renderEllipseNode, renderTextNode, renderVectorNode, renderLineNode, renderStarNode, renderPolygonNode で各ノードをレンダリングします。

renderTextNodeAsPath でテキストをパスとしてレンダリングします。

## シーングラフ

SceneNodeId でノード識別、makeSceneGraph でシーングラフ構築、findSceneNode でノード検索、SceneGraphDiff で差分を表現します。

RenderTreeResolver, RenderTreeCacheEntry, WebGLRenderTreeCache でレンダーツリーを管理します。

RenderNodeComponentImpl, RenderPathNodeComponentImpl, RenderRectNodeComponentImpl, RenderTextNodeComponentImpl, RenderFrameNodeComponentImpl, RenderGroupNodeComponentImpl, RenderImageNodeComponentImpl, RenderEllipseNodeComponentImpl で各コンポーネントを実装します。

## ジオメトリ

AffineMatrix でアフィン変換、Bounds で境界、Point で座標を表現します。

rectPoints, ellipsePoints, roundedRectPoints, rectCenterlinePoints で頂点生成、samePoint で比較を行います。

PathBbox でパス境界、CubicSegment で3次曲線、Segment でセグメントを表現します。

## ストローク

PathStrokeOptions, StrokeDashOptions, RectStrokeAlign でストローク設定を行います。

tessellateSharpRectAlignedStroke, tessellateRoundedRectAlignedStroke, tessellateDashedRectStroke でテッセレーションを行います。

indicesToVertices でインデックス変換、thickenDashedPolyline で太線化、splitPolylineByDashPattern で分割、appendDrawnDashPoint, pushCompletedDashSegment, normalizeDashPattern でダッシュ処理を行います。

## ペイント

resolveFillResult, resolveTopFillResult でフィル解決、PaintProps, GeometryProps, EffectsProps でプロパティを表現します。

GradientStop, GradientDirection でグラデーション、AngularGradientFillParams, DiamondGradientFillParams, RadialGradientParams でパラメータを指定します。

## イメージ

ImageDimensions, ImagePatternLayout, ImageTextureResource, ImageTransformParts でイメージを管理します。

computeImagePatternLayout, createImagePatternDef でパターン処理、TiledImagePatternParams, ScaledImagePatternParams でタイリングを設定します。

## エフェクト

ShadowParams でシャドウ、ResolvedEffectStack でエフェクトスタック、ShapeEffectStackParams, VertexShapeEffectParams でパラメータを指定します。

EffectRendererCapability, WebGLEffectRendering, WebGLEffectRenderingParams でWebGLエフェクトを管理します。

EffectRequirement, EffectRequirementKey, EffectCoverageGap でエフェクト要件を表現します。

## テキスト

FontWeight, TextAnchor でフォント設定、GlyphRecord, GlyphGenResult でグリフを管理します。

FontNameRecord でフォント名、textRequiresGlyph で判定、fontSupportsText でサポート確認を行います。

normalizeFontStyle でスタイル正規化、loadPrimaryOrFallbackFont でフォント読み込み、CachedTextFontSource でキャッシュを管理します。

## テクスチャ

TextureEntry, TextureResource, TextureResourceId でテクスチャを管理、makeTextureResourceId でID生成を行います。

## ブレンド

blendModeStyle, convertBlendMode でブレンドモード変換を行います。

## SVG

SvgArcParams, SvgStrokeCap, SvgStrokeJoin でSVGパラメータ、getSvgSize でサイズ取得、formatClipPathShape, formatFilterPrimitive でフォーマットを行います。

collectDefIds, collectFillDef でdef収集を行います。

## Boolean演算

BooleanPathInput, BooleanOperationType, BooleanEvaluationResult, BooleanEvaluationError でBoolean演算を管理、isBooleanOperationName で判定、resolveNextPath, errorToMessage でパス解決を行います。

## ビューポート

ViewportRect, ViewportCullOptions でビューポートを管理、requireSceneViewport でビューポート要求を行います。

## WebGL

GLContext, ShaderSources, ShaderProgramName でシェーダーを管理、matrixToGLUniform で行列変換、DrawStencilFillParams でステンシル描画を行います。

WebGLViewportPixelRatioInput, WindowWithRenderSceneGraph でWebGL設定を管理します。

## コーナー

clampRadius で半径クランプ、normalizeCornerRadii, pushRoundedCornerPoints でコーナー処理、roundedRectFillPoints でフィル頂点、GenerateRoundedRectContourOptions でオプションを指定します。

## ユーティリティ

hexToRgb, hexToColor, rgbToColor で色変換、quantizeUp で量子化、finitePositiveOrOne, requireFinitePositive で検証を行います。

resolveStrokeAlign でストローク位置解決、resolveWrapper, makeResolvedPath でパス解決を行います。

sanitizeFilename でファイル名サニタイズ、createPngDataUri, createJpegDataUriWithLateSof でDataURI作成を行います。

createSvgExportSettings でエクスポート設定、createPathRenderContext でパスコンテキスト作成を行います。

IndividualStrokeWeights で個別ストローク幅を指定します。

## フィクスチャ生成

FrameData, FrameInfo, FrameMeta, FrameOptions, FrameFixture でフレームを管理します。

FillChild, ShapeChild, EffectChild, ChildData, Child, Parent でノード階層を管理します。

FillFrameData, ShapeFrameData, EffectFrameData で特化フレームを表現します。

FixtureData, ParsedFixture, ParsedData でフィクスチャデータを管理します。

createGUID, getNextID, createEnumValue, createTransform でデータ生成、createRectNode, createFrameNode, createTextNode, makeTextNode, makeWrappingTextNode でノード作成を行います。

createSolidPaint, createSolidRed, createSolidBlue, createSolidGreen, createSolid50Opacity でソリッドペイント作成を行います。

createLinear45, createLinearVertical, createLinearHorizontal, createLinearMultiStop でリニアグラデーション作成を行います。

createRadialCentered, createRadialOffset でラジアルグラデーション作成を行います。

addDiamondGradient, addAngularGradientRect, addAngularGradientBasic でグラデーション追加を行います。

addImageFillBasic, addImageFillMulti, addImageFillCircle, addImageFillRounded, addImageFillWithEffect, addImageFillWithShadow でイメージフィル追加を行います。

gradientSunset, gradientVertical, gradientRadialGlow, gradientBlueToGreen でプリセットグラデーントを使用します。

## テスト

comparePngs, compareSvgs, CompareResult, ComparePngsParams で比較を行います。

svgToPng でSVG変換、loadFigFile, loadFixture, loadFixtures でロード、ensureDirs, ensureDebugDir でディレクトリ作成を行います。

safeName, getActualSvgFiles, selectFixturePages でファイル操作を行います。

hasFilter, hasClipPath, hasGradient で判定、countShapeElements, extractShapeElements で要素処理を行います。

LayerInfo でレイヤー情報、RectOptions でオプションを表現します。

createFakeFont, createFakeFontLoader でフェイクフォント作成、getFontLoader でローダー取得を行います。

generateSnapshots でスナップショット生成を行います。

generateFillFixtures, generateShapeFixtures, generateTextFixtures, generateEffectFixtures, generateLayoutFixtures, generateClipFixtures, generateComponentFixtures, generateCompositeFixtures, generateImageFillFixtures, generatePaintAdvancedFixtures, generateVectorWindingFixtures, generateDecorationComboFixtures でフィクスチャ生成を行います。

## ハーネス

WebGLHarness でWebGLテスト、IDAllocator でID割り当て、FigFile, Color でデータを表現します。

getParsedData, findDesignByName でパースデータ操作を行います。

makeRect, makeRoot, makeProps, makeScene で構造作成、paintWith でペイント適用、WrapperProps, BaseProps, SizeProps でプロパティを表現します。

MultiFillRectLayers, MultiFillRectLayersProps, MultiFillEllipseLayers, MultiFillEllipseLayersProps でマルチフィルを管理、makeEllipseWithOutsideStroke で外部ストローク楕円を作成します。

AddOp, RemoveOp, DiffOp, ReorderOp でオペレーション、AddFrameOptions でオプションを指定します。

ElementSize, ElementBounds でサイズ境界を表現します。

SvgPathContoursParams でパスコンツールパラメータを指定します。

## See Also

- wiki://fig-package — パーサー
- wiki://core-concepts — レンダリングパイプライン
