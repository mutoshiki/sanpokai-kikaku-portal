# Apps Script 履歴連携の復旧計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 公開ポータルとフォームメーカー間の履歴連携を再現可能なソース管理下で復旧し、公開画面で準備完了と履歴更新を確認できるようにする。

**Architecture:** ポータル側の`historyChannel`契約とApps Script側の履歴送受信を、取得・照合した実ソースに基づいて一致させる。Apps Scriptのソースをリポジトリで再現可能にしてから、ローカル契約テスト、ステージング相当のブラウザ確認、本番公開の順に進める。公開時はApps ScriptとGitHub Pagesの両方の版を記録する。

**Tech Stack:** Google Apps Script（HTML Service、`google.script.url`、`postMessage`）、既存の`public/form-maker/index.html`、Node.js、Playwright、GitHub Actions / GitHub Pages。

**Spec:** [Carbon公式ガイドに基づく評価・改善計画書](2026-10-13-carbon-audit-improvement-plan.md)のP1-2・P2-4・Task 7〜8、および本書の停止時点の状態と受け入れ条件。

## 全体制約

- この文書の作成時点では、実装・ロールバック・再デプロイを行わない。
- Apps Scriptの未取得ソースを推測して変更しない。編集前に現在の本番デプロイと完全なソースを照合する。
- フォーム作成、編集者招待、実データ送信は、テストデータと対象環境が明示されるまで行わない。
- 本番デプロイ、GitHubへのpush、公開設定変更は、実装完了後の明示的な再指示を受けて行う。
- 実装を再開する場合は、ユーザー指定のgpt-6-lunaを使う。
- 現行の`source: 'sanpokai-form-history-child'`、`historyChannel`、`history-ready`、`history-update`契約を維持する。契約を変える場合はホスト・子・テストを同時に更新する。
- 履歴は`formId`で統合し、既存項目を保持してから最新10件に制限する。無効なレコード1件で全履歴を消さない。
- 既存のCarbon評価計画で採用済みのUI改善を再設計しない。今回の対象はフォーム履歴連携と、その公開検証を妨げているチェックに限る。

## 実装状況（2026-10-13）

- ローカル実装、Apps Script編集ソースへの保存、Apps Script v26の本番デプロイまで完了。既存デプロイIDは維持。GitHubへのpushとPages公開は実行中。
- Apps Scriptの`Code.gs`、`Index.html`、`appsscript.json`をエディタから取得した。`clasp clone`は権限不足で失敗したため、アカウント全体のApps Script API設定は変更していない。Apps Scriptエディタのマニフェスト表示設定も取得後に元へ戻した。
- 本番実行時の通知originは`*-script.googleusercontent.com`形式だった。既存の許可条件がこの形式を拒否し、準備中表示が残っていた。iframeのsource ancestryも確認し、該当Googleホスト形式をテスト可能な独立関数に切り出して許可した。
- レビューで履歴の送信先と受信元の検証不足が見つかったため、ポータルが`historyOrigin`を渡し、Apps Scriptは`https://mutoshiki.github.io`またはローカル検証用loopback originだけを許可するようにした。子からの送信はこのoriginへ固定し、親からの履歴受信も`event.origin`を検証する。任意サイトへの漏えいと履歴注入の両方を回帰テストで再現後に防いだ。
- フォームメーカーの保存済み編集ソースに、親テーマを反映する処理とlocalStorage保存失敗時も成功UI・親通知を続行する処理を追加した。
- 既存のproduction smokeは、実際の子画面がCarbon Reactではなく独自CSSのHTMLであるのにCarbon React用のselectorを読んでいた。期待条件を実際の`data-theme='g100'`と背景色へ合わせ、dark theme assertionは残した。
- 自動検証は履歴14件、Apps Scriptクライアントの統合smoke、portal browser/theme/focus smoke、同一origin履歴smoke、Pages deployment contract、Vite buildが成功。BuildにはCarbon font assetの未解決参照警告がある。
- Apps Script v26は本番デプロイ済みだが、GitHub Pagesの修正版はまだ公開していないため、両者を通したproduction smokeは未実施。
- 2026-10-13、Apps Script v26を既存デプロイID`AKfycbwveM99euD8V5dxB6xLPYlpHuIc-KJlaaP8LHffh6ZMQBnAmO6XwX_ijQG-brUgqZmj`へ公開した。デプロイ説明は`History bridge origin and privacy fix (2026-10-13)`。実行ユーザーとアクセス対象は既存設定を維持。
- `clasp`によるデプロイ済みv25とプロジェクト編集ソースの完全比較、およびv24/v25差分比較は未完了。したがって、取得ソースが現行デプロイの全ファイルと完全一致すると断定しない。

## 停止時点の状態と確認済みの事実

| 対象 | 確認結果 | 確認できていないこと |
|---|---|---|
| GitHub Pages | PR #13は`a4a8b0515b6e887a0d5bf9ccb7d95c585716904d`としてマージ済み。公開HTMLは稼働中Apps Script URLを参照し、フォーム画面が表示される | 履歴の準備完了通知が本番ホストへ届くこと |
| Apps Script | プロジェクト「山歩会フォームメーカー」の稼働デプロイをv25へ更新済み。デプロイIDは`AKfycbwveM99euD8V5dxB6xLPYlpHuIc-KJlaaP8LHffh6ZMQBnAmO6XwX_ijQG-brUgqZmj` | v25の履歴ブリッジがホストと正常に通信すること。ローカルに完全一致するソースが保存されていること |
| 履歴表示 | v25反映後も公開側で「読み込みに時間がかかっています」が残った | `historyChannel`の受け渡し、Googleラッパーを経由した`postMessage`のsource/origin、送信タイミングのどこで不達になるか |
| CI | Pagesのビルドとdeployは成功。run `38373328106`の`production-smoke`は`embedded Apps Script React UI did not reach Carbon g100 inside the Google wrapper`で失敗 | 失敗が今回の履歴変更に起因するか、既存のテーマ連携・Googleラッパー差異に起因するか |
| 作業ツリー | `main`は`origin/main`と一致。`production-pages-evidence/`は未追跡で存在 | その証拠ディレクトリの由来・必要性。計画実行時に内容を調べてから扱う |

Apps Scriptエディタで`Index.html`へ履歴ブリッジを追記し、既存の稼働デプロイをv25へ更新した。ホスト側の待機表示が解消しなかったため、成功したとは扱わない。`Code.gs`に試した編集は保存されておらず、確認時には元の`doGet()`へ戻っていた。フォーム作成・送信は行っていない。v24へのロールバックも行っていない。

## 公式指針とこの計画の判断

| 種別 | 指針／判断 | 採否と理由 |
|---|---|---|
| Carbon公式 | Empty statesは、空の状態・読み込みや取得失敗を区別し、次に取れる操作を示す | 採用。準備完了を確認できないときは待機／復旧状態を明確にする。今回の不達を「履歴なし」と表示しない |
| Carbon公式 | Notificationは状態変化へのフィードバックを提供する | 採用。Apps Scriptからの準備完了・履歴更新をホストが受け取った時だけ待機表示を解除する |
| Carbon公式 | 公式ガイドはApps Scriptの通信方式、信頼するorigin、履歴データの保存場所を規定しない | そのような仕様をCarbon準拠として主張しない。通信契約とデータ統合はアプリの設計判断としてテストする |
| アプリ判断 | iframeの`load`だけで連携成功としない | 採用。Googleの中間ラッパーがロードされても子アプリの準備完了とは限らない |
| アプリ判断 | Apps Scriptソースを取得し、リポジトリのホスト契約と合わせてから編集する | 採用。未取得の`doGet(e)`やGoogleラッパー仕様を推測で足さないため |
| アプリ判断 | 現状でv25を直ちに戻す | いったん保留。v25が履歴を壊したという因果は未確認であり、復旧先となる管理済みソースも未確定。再開時にv24との機能差と影響を確認し、判断を記録する |
| アプリ判断 | production-smokeのCarbon g100 assertionを削除・緩和する | 不採用。テストが失敗する原因を解明せずに削ると、ダークテーマ連携の実欠陥を隠すため |

## Review Focus

- Apps Script URLに`historyChannel`が欠落・空文字で渡る場合は、ホストが誤った準備完了とみなさず、直接起動の復旧リンクを使えることをテストする（Task 2）。
- Googleの中間iframeから遅れて通知が来る場合は、正規の準備完了を受け入れ、偽のsource/channelを無視することをテストする（Task 2）。
- 既存履歴10件に新しいformIdと同一formIdの更新が届く場合は、更新後の最新10件が決定的な順序で表示されることをテストする（Task 2）。
- Apps Script側のlocalStorageが空・破損・アクセス不可の場合は、アプリが起動し、ホストが状態を区別して案内することをテストする（Task 2）。
- Googleラッパー内のテーマ確認に失敗した場合は、失敗診断を残し、Carbonテーマ検証を無効化せず原因を特定できることを確認する（Task 3）。

---

### Task 1：稼働中Apps Scriptのソースとデプロイを再現可能にする

**Files:** Apps Scriptプロジェクトの全ソースを`apps-script/form-maker/`に保存（配置は既存構成と衝突がないことを確認して確定）、`README.md`に同期手順を追記。必要なら`appsscript.json`と`clasp.json`を追加する。

**Interfaces:** 正式なデプロイ対象は、プロジェクトID`1EmVk9jbbmlr5fJH4PlCnufvS92kqfefyZxnli0BCxum2f65_vlxUYtGu`。稼働デプロイIDは上記v25のID。ソースの取得方法は実行時点で利用可能なApps Script API / claspを確認し、完全取得できる方法を選ぶ。

- [x] Apps Scriptエディタの`Code.gs`、`Index.html`、manifestを取得し、`doGet`、既存localStorageキー、v25のデプロイIDを確認した。デプロイ日時は未記録。
- [ ] エディタの3ファイルをローカルへ取得した。`clasp clone`が権限不足で失敗し、v25のimmutable version sourceおよびv24との完全比較は未確認。差分照合済みとは扱わない。
- [ ] v24とv25を比較し、履歴ブリッジ以外の差分と現在の本番版に必要な変更を列挙する。
- [x] 取得したソースを`apps-script/form-maker/`へ保存し、再取得・差分確認手順をREADMEへ記した。認証ファイルは`.gitignore`に追加。
- [ ] Git差分がApps Scriptソースと同期手順だけであることを確認する。既存の`production-pages-evidence/`は内容を確認するまで変更しない。

### Task 2：ホスト・Apps Script間の履歴契約を修正し、回帰テストを作る

**Files:** `public/form-maker/index.html`、Apps Scriptの履歴表示HTML、`tests/form-history.test.mjs`、`tests/portal-history-origin-smoke.cjs`、必要なApps Script向け契約fixture。

**Interfaces:** ホストはURL queryの`historyChannel`を子へ渡す。子は`{source:'sanpokai-form-history-child', channel, type:'history-ready'|'history-update', history:FormRecord[]}`を親へ送る。親は有効なchannelとsourceを検証し、許可するorigin/sourceの条件を実測に合わせて限定する。

- [x] 実ブラウザーの通知originが既存許可条件から外れることを確認し、`history-ready`が除外される原因とした。
- [x] 送信元ホスト、iframe source ancestry、信頼できない親originへの履歴漏えい・履歴注入、およびApps Scriptクライアントの履歴ready/update、channelなし、localStorage保存失敗を検証するテストを追加した。
- [x] 回帰テストを追加前後に実行し、追加前の失敗・修正後の成功を確認した。
- [x] Apps Script編集ソースはページ準備時に`history-ready`、フォーム作成後に`history-update`を送る。保存できない時も作成結果表示と親通知を続行する。
- [ ] ホストは有効なready受信時にだけ待機案内を解除する。タイムアウト後の遅延readyも受理し、明示的な取得失敗と空履歴を別状態にする。
- [ ] 両テストを再実行する。10件制限はformId統合・更新優先・日時降順ソートの後に適用することをassertする。

### Task 3：Carbon g100 production-smoke失敗の原因を独立して特定する

**Files:** `tests/production-pages-smoke.cjs`、必要なGoogle wrapper fixture、GitHub Actionsの該当workflow（原因がworkflowにあると確認できた場合のみ）。

**Interfaces:** 既存のproduction smokeは公開ポータル・Apps Scriptラッパー内のテーマ状態を確認する。完了条件は`document.documentElement.dataset.theme === 'g100'`に相当する子画面の状態を得ることで、assertion自体は保持する。

- [ ] run `38373328106`のログと`tests/production-pages-smoke.cjs`の実行段階を照合し、テーマ設定・保存・Google wrapper横断のどのassertで失敗したかを確定する。
- [ ] 公開サイトへ依存しない再現テストまたは診断ログを追加し、host preference、iframe URL、子の解決テーマ、通知受信時刻を個別に記録する。
- [x] Google wrapperから届く実際のホスト名を観測し、既存origin検証が拒否することを確認した。親メッセージ到着後の`historyChannel`通知でhost側が準備済みになる経路をローカル自動テストに追加した。
- [x] smokeのテーマassertionを実際のHTML子アプリに合わせて維持・修正し、mock統合smokeでlight/dark適用を検証した。公開URLに対する更新後のproduction smokeは未実施。

### Task 4：公開前の一式確認とリリース記録を用意する

**Files:** `README.md`、`tests/production-pages-smoke.cjs`、CI workflow、Apps Scriptデプロイ手順。

- [x] `npm run test:history`（14 tests + Apps Script client smoke）、`npm run build`、`npm run test:browser`、`node tests/portal-history-origin-smoke.cjs`、`node tests/deployment-contract.cjs`を実行し成功を確認した。
- [ ] 修正は未公開のため、公開URLへのproduction smokeは実施していない。PagesとApps Scriptを同じ修正版に更新した後に、g100と履歴ready/updateを一体で確認する。
- [ ] 公開手順にApps Scriptの版・デプロイID、Pagesのcommit SHA、切り戻し先を記録できる項目を加える。Apps Scriptのみ、Pagesのみの更新で契約がずれる場合の復旧手順も記す。
- [ ] 本番変更はこの計画の実装完了後にユーザーが明示的に再開を指示した場合にだけ実施する。本番確認はフォームの作成・送信なしで可能な範囲に限定し、実データ検証が必要なら別途明示する。

## 完了条件

- Apps Script v25相当の完全なソースが管理され、稼働中のデプロイ版との差分が説明できる。
- 初期履歴、更新、空履歴、遅延通知、無効通知、10件制限が自動テストで検証される。
- 公開Smokeでフォームメーカーがreadyとなり、待機表示が残留しない。
- Carbon g100のproduction-smoke失敗原因が修正・検証されるか、Google実行環境の制約として根拠付きで範囲を特定する。
- 変更・検証・デプロイ版が追跡可能で、フォームの実作成・送信なしに確認できた範囲が明記される。
