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

## 履歴の仕組み

GitHub Pages 上では、このサイトと企画ツールはどちらも `https://mutoshiki.github.io` オリジンになります。同じブラウザの `localStorage` を読み、旧保存形式とReact版の `sanpo-react:v1:<encodedRoomId>:room` の両方から企画名・更新日時を表示します。

企画ツールは企画を開いた時刻を索引 `sanpokai_portal_project_history_v1` と互換キー `syawari_last_opened_at_<roomId>` に保存します。room IDで統合し、閲覧日時がない既存企画は更新日時を「最終更新」として表示します。企画とフォームの履歴状態は別々に読み取るため、片方の破損で他方を空表示にしません。

履歴はブラウザ単位です。別端末や別ブラウザとの同期は行いません。空の履歴と読み取りエラーは別の状態として表示します。

フォームメーカーの親ページは同じフォームIDの履歴を更新日時で統合し、作成日時の新しい10件を残します。関連アプリから開く場合も、この親ページを経由して履歴を共有します。

Apps Scriptフォームメーカーの管理対象ソースは `apps-script/form-maker/` にあります。親ページはGoogleの中間ラッパーを経由した通知元を検証し、フォームメーカー側は許可originの親とだけ履歴を送受信して、受け取った履歴をローカルへ統合します。詳細な同期方法は同ディレクトリのREADMEを参照してください。

## ブラウザQA

Quality Guardはビルド後の画面をChromiumで390×844と1280×900の両方で描画し、Carbon ClickableTile、ContainedList、4ツールのリンク、企画履歴の名称・並び順、履歴アクション、横overflow、console/page errorを検査します。管理ポリシーで通常URLナビゲーションが制限される環境でも同じ確認ができるよう、自己完結したビルドを `about:blank + page.setContent` で読み込む方式です。

履歴ロジックとApps Script連携は `npm run test:history`、画面とテーマ操作は `npm run test:browser`、ビルド成果物の同一オリジン2タブ連携は `node tests/portal-history-origin-smoke.cjs` で確認できます。Apps Scriptの統合検査は本物のフォーム作成や共有を行わず、成功応答をテスト環境内で模擬します。
