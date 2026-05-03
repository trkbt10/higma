# @higuma/png

純粋TypeScript実装のPNGエンコーダー/デコーダー。

## エンコード

encodeRgbaToPng でRGBAをPNGに変換、encodeRgbaToPngDataUrl でDataURLとして取得します。

packPng, encodePng で低レベルパッキングを行います。

PackerOptions でパッカーオプション、DeflateLevel で圧縮レベルを指定します。

## デコード

parsePng でPNGパース、parseChunks でチャンクパースを行います。

ParseResult でパース結果、ParseOptions, ParserOptions でオプションを指定します。

ParserDependencies でパーサー依存、resolveOptions でオプション解決を行います。

## 検出

isPng でPNG判定、PNG_SIGNATURE で署名を参照します。

## 高レベルAPI

createPngImage でPngImage作成、readPng で読み込み、writePng で書き込みを行います。

PngData, PngImage, PngMetadata でデータ型を表現します。

## フィルター

FilterFn でフィルター関数型、FilterArgs, FilterSumArgs, FilterDataArgs で引数を表現します。

filterNone, filterSub, filterUp, filterAvg, filterPaeth でフィルター適用を行います。

filterSumNone, filterSumSub, filterSumUp, filterSumAvg, filterSumPaeth でフィルターサムを計算します。

FilterSumFn でサム関数型、FilterOptions でオプション、FilterDependencies で依存を表現します。

resolveFilterTypes でフィルタータイプ解決、unfilter でフィルター解除を行います。

## ビットパッカー

RGBA でRGBA型、readRGBA で読み込み、writeRGBA で書き込みを行います。

BitmapInfo でビットマップ情報、BitPackerOptions でオプションを指定します。

computeInBpp で入力bpp計算、computeOutBpp で出力bpp計算を行います。

checkBigEndian でビッグエンディアン判定、extractRawRGBA で生RGBA抽出を行います。

## フォーマット正規化

ImageInfo, ImagePass でイメージ情報を表現します。

dePalette でパレット解除、scaleDepth でデプススケールを行います。

PixelBufferArgs, PixelMapper, PixelCustomMapper でピクセルマッピングを表現します。

checkTransparent で透明チェック、replaceTransparentColor で透明色置換、normalizeRgbaData でRGBAデータ正規化を行います。

NormaliseImageData で正規化データを表現します。

## 読み込み

ReadRequest で読み込みリクエスト、ResolvedOptions で解決済みオプション、getByteWidth でバイト幅取得を行います。

## See Also

- wiki://buffer-package — Base64/DataURL変換
- wiki://fig-renderer-package — 画像エクスポートで使用
