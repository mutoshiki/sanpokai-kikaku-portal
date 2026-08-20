# 山歩会企画ツール ポータル

既存の各ツールには手を加えず、リンクだけでつなぐ静的ポータルです。

## 構成

- `index.html` — トップページ
- `guide.html` — 提出書類作成アプリの使い方ガイド
- `assets/css/styles.css` — Carbon Design Systemに沿ったレイアウト/トークン
- `assets/js/main.js` — ガイド目次の現在位置表示

## 外部リンク

- フォーム作成: Google Apps Script Web App
- 企画一覧: `https://mutoshiki.github.io/circle-kikaku-tools/`
- 提出書類作成: `sampokai-submission-builder` の最新GitHub Release

## ローカル確認

単純な静的ファイルなので `index.html` を直接開けます。ローカルサーバーを使う場合:

```bash
python -m http.server 8080
```

## デザイン方針

Carbon Design SystemのUI Shell Header、16-column grid、2x spacing、g10相当のカラー、Clickable Tile、Buttonの仕様を基礎にしています。角丸や装飾を増やさず、タスクへの導線を優先しています。
