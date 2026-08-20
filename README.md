# 山歩会企画ツール

山歩会の企画作業を1か所から開くための静的ポータルです。

既存ツールのコードは統合せず、リンクだけで接続します。

- 新しい企画を作る: Google Apps Script のフォームメーカー
- 過去に開いた企画: `circle-kikaku-tools` が同一オリジンの `localStorage` に保存した企画データを一覧表示
- 提出書類: `sampokai-submission-builder` の使い方ガイドとダウンロード導線

## 企画一覧の仕組み

GitHub Pages 上では、このサイトと `circle-kikaku-tools` はどちらも `https://mutoshiki.github.io` オリジンになります。
そのため、このサイトは `circle-kikaku-tools` が保存している `sampokai_v10_split_<roomId>` を読み取り、企画名と最終更新日時を表示できます。

既存の `circle-kikaku-tools` 側は変更しません。
