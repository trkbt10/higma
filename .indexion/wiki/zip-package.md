# @higma/zip

ZIPファイル操作。.fig ファイルはZIPアーカイブなのでこのパッケージを使用。

## パッケージ操作

loadZipPackage でZIPロード、createEmptyZipPackage で空パッケージ作成を行います。

ZipPackage でパッケージ型、ZipEntries でエントリー型を表現します。

## 生成オプション

ZipGenerateOptions で生成オプション、ZipWriterOptions でライターオプションを指定します。

CompressionLevel で圧縮レベル、normalizeCompressionLevel でレベル正規化を行います。

## ユーティリティ

isBinaryFile でバイナリファイル判定を行います。

toUint8Array でUint8Array変換、u8ToArrayBuffer でArrayBuffer変換を行います。

createZipPackageFromEntries でエントリーからパッケージ作成を行います。

createTestZipBytes でテストZIPバイト作成を行います。

## See Also

- wiki://fig-package — ZIPから抽出したデータをパース
- wiki://fig-builder-package — ZIPとしてエクスポート
