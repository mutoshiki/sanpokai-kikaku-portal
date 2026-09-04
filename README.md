# 山歩会企画ツール

山歩会で使う既存ツールへの入口となる静的ポータルです。

既存ツールのコードは統合せず、リンクだけで接続します。

- 企画ツール: `circle-kikaku-tools`
- フォーム作成ツール: Google Apps Script のフォームメーカー
- 最近開いた企画: `circle-kikaku-tools` が同一オリジンの `localStorage` に保存した企画データを一覧表示

## UI方針

UIは React 19 + 公式 `@carbon/react` をソースのownerとしています。Carbon Design System の用途定義に従い、以下を採用しています。

- 単純な1ページ構成: Carbon Header
- 別ツールへのナビゲーション: ClickableTile
- 履歴一覧: `ContainedList` / `ContainedListItem`
- ページ遷移には Button ではなく Link を使用

Viteでビルドした `dist` をGitHub Pagesへ配信します。手書きのCarbon風コンポーネントへ戻さず、React/Carbon側でUIを管理します。

## 企画一覧の仕組み

GitHub Pages 上では、このサイトと `circle-kikaku-tools` はどちらも `https://mutoshiki.github.io` オリジンになります。
そのため、このサイトは `circle-kikaku-tools` が保存している `sampokai_v10_split_<roomId>` などのローカル保存データを読み取り、企画名と最終更新日時を表示できます。

既存の `circle-kikaku-tools` 側は変更しません。

## ブラウザQA

Quality Guardはビルド後の画面をChromiumで390×844と1280×900の両方で描画し、Carbon ClickableTile、ContainedList、4ツールのリンク、企画履歴の名称・並び順、履歴アクション、横overflow、console/page errorを検査します。管理ポリシーで通常URLナビゲーションが制限される環境でも同じ確認ができるよう、自己完結したビルドを `about:blank + page.setContent` で読み込む方式です。
