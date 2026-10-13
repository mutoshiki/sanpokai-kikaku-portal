# Apps Script フォームメーカー

このディレクトリは、Apps Scriptプロジェクト「山歩会フォームメーカー」のソースを管理します。

- Script IDは`.clasp.example.json`を参照してください。
- 元ソースは2026-10-13にApps Scriptエディタから取得した`Code.gs`、`Index.html`、`appsscript.json`です。取得後、フォーム履歴の保存失敗を許容する処理とテーマ連携を`Index.html`へ実装し、エディタの編集ソースへ保存しました。
- 取得時の稼働デプロイはv25でした。2026-10-13に同じデプロイIDのv26を公開し、URLとアクセス設定は維持しています。公開URLはポータルの`public/form-maker/index.html`で管理します。
- GitHub PagesはPR #14、main commit `f03a1f822becd973139165c0f92cf25501495e74`で公開しました。GitHub Actions run `38384436553`のproduction smokeは成功し、g100テーマと準備完了通知を確認しています。隔離ブラウザ診断でも架空の親履歴がApps Script画面へ届くことを確認しました。
- Apps Script切り戻し先はv25、Pagesの直前mainは`a4a8b0515b6e887a0d5bf9ccb7d95c585716904d`です。v25へ戻すとorigin拒否の不具合も再発するため、必要時は修正版を前進デプロイしてください。
- `.clasp.json`と`.clasprc.json`は認証・プロジェクト設定を含むため、Gitへ追加しません。

## 同期

Google公式の[claspガイド](https://developers.google.com/apps-script/guides/clasp)に従い、Apps Script APIを利用できるアカウントで`clasp`を設定します。`.clasp.example.json`を`.clasp.json`へコピーし、認証情報は`.clasprc.json`に置きます。その後、このディレクトリで`npx @google/clasp pull`を実行してリモートのファイルを取得します。

Apps Script APIへのアクセスが許可されない場合、プロジェクト設定でマニフェスト表示を有効にし、エディタから3ファイルをローカルへコピーします。現在のソース取得では`clasp clone`が「The caller does not have permission」で失敗したため、この方法を使いました。API利用設定はプロジェクト所有者が確認してください。

`clasp pull`またはエディタからのコピー後にGit差分を確認してください。リモートへ反映する`clasp push`とWebアプリの再デプロイは、公開リリースの承認を受けた後に実施します。
