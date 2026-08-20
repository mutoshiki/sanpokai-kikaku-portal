# 山歩会企画ツール

山歩会で使う既存ツールへの入口となる静的ポータルです。

既存ツールのコードは統合せず、リンクだけで接続します。

- 企画ツール: `circle-kikaku-tools`
- フォーム作成ツール: Google Apps Script のフォームメーカー
- 過去に開いた企画: `circle-kikaku-tools` が同一オリジンの `localStorage` に保存した企画データを一覧表示

## UI方針

Carbon Design System の用途定義に従い、以下を採用しています。

- 単純な1ページ構成: UI Shell Header base
- 別ツールへのナビゲーション: Clickable Tile
- 過去企画の一覧: Structured List
- ページ遷移には Button ではなく Link を使用

## 企画一覧の仕組み

GitHub Pages 上では、このサイトと `circle-kikaku-tools` はどちらも `https://mutoshiki.github.io` オリジンになります。
そのため、このサイトは `circle-kikaku-tools` が保存している `sampokai_v10_split_<roomId>` などのローカル保存データを読み取り、企画名と最終更新日時を表示できます。

既存の `circle-kikaku-tools` 側は変更しません。
