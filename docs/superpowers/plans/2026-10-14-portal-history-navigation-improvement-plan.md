# ポータルの履歴・導線・Carbonレイアウト改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.
> **今回の実行指定:** ユーザーは実装モデルにLunaを指定した。Lunaが `superpowers:executing-plans` で順に実装する。計画作成者は実装を開始せず、新しいチャットやサブエージェントも作成しない。

**Goal:** 最近の企画へ戻る操作と4ツールへの到達を両立し、誤った1970年表示をなくし、フォーム操作を明確にする。

**Architecture:** 既存のReact/Carbon構成を保つ。`portalHistory.js`で欠損日時・統合・並び順を処理し、`App.jsx`で各履歴の3件プレビューと展開状態を管理する。`styles.scss`とCarbon Gridで表示階層とレスポンシブ配置を整え、既存の応募連携・テーマ・履歴通信を保持する。

**Tech Stack:** React 19、Carbon React（調査端末の実インストールは1.115.0）、Carbon icons/pictograms、SCSS、Vite、Node.js test runner、Playwright、GitHub Actions/Pages。

**Spec:** 本書「承認済み仕様」が仕様の固定版。2026-10-14、このチャットの改善案6項目をユーザーが「いいねすべて実装しよう」と承認し、実装計画とLunaへの引継ぎを依頼した。以前のCarbon監査計画は履歴資料であり、今回の画面仕様は本書を優先する。

## Global Constraints

- 作業対象はこのポータル。Circle企画ツール、Apps Script、Firebaseの実装・ルール・実データには変更を加えない。
- 4ツールの名称・説明文・順序・URL・新しいタブで開く動作を維持する。応募フォームメーカーは現在の `/form-maker/` 入口と応募連携付きA版を維持する。
- ツールは1カード1リンクの `ClickableTile`。左48pxの既存ピクトグラム、右のテキスト、右下のLaunchを維持する。独自SVG・絵文字・カード内の独立CTAを追加しない。
- 企画の識別子はroomId、フォームはformId。同名の別IDを統合しない。履歴の表示上限を保存上限へ転用しない。
- 読取と展開・折りたたみはlocalStorageへ書き込まない。閲覧時刻の更新は、既存どおり企画リンクを開いたときだけ行う。
- `public/form-maker/history-utils.js` の既存「最新10件」保存契約は維持する。「すべて見る」は現在このブラウザに保存され、読取可能な項目をすべて表示する意味であり、過去に失われた履歴の復元を約束しない。
- 既存の `ThemePreferenceProvider` を使う。冗長なThemeを追加せず、light/dark/system、保存と親子連携を維持する。
- 新規依存・Carbonのバージョン更新は不要。導入済みpackage/exports/DOMを確認し、Carbon MCPで対象APIと公式仕様を再確認してから編集する。
- SCSSはCarbonのspacing/type/themeトークンを使う。新たな `.cds--` 内部クラスへの上書きを追加せず、既存上書きは対象範囲を必要最小限で整理する。
- 初期調査で主チェックアウトはmainがorigin/mainより3コミット遅れ、未追跡の `.playwright-cli/` と別計画書がある。reset/stash/無関係なstageをせず、実装開始時に状況を確認する。
- 本書作成は計画のみ。公開作業は、Lunaへの実行指示が本番反映を含む場合にTask 5の公開手順まで行う。以前の応募連携復旧の公開許可を、今回のUI変更の公開許可として流用しない。

## 承認済み仕様

### 情報順序と表示件数

1. 小さな本文h1「山歩会企画ポータル」。ブランド名は既存ヘッダーにも残す。
2. 「最近開いた企画」：初期表示3件。
3. 「ツール」：現在の4枚を現在の順序で表示。
4. 「作成したフォーム」：初期表示3件。

- 履歴が空・部分取得・取得不可でもDOM上のセクション順は固定する。
- 各履歴が4件以上なら末尾に「すべて見る」。クリックするとその履歴だけ全件表示し、ボタン文言を「表示を減らす」にする。
- ボタンに `aria-expanded` と一覧への `aria-controls` を付け、アクセシブル名には対象を含める（例：`最近開いた企画をすべて見る`）。3件以下なら展開ボタンは表示しない。
- 企画・フォームの展開状態は独立。再読み込みは3件表示へ戻す。storage/visibilityイベントの再読取では利用者の展開状態を維持する。
- 縮小ボタンがフォーカスされた状態で閉じてもフォーカスを失わない。更新で件数が3以下になりボタンが消える場合は、その一覧の見出しへフォーカスを移す。
- 空状態・再読込・部分取得の既存案内は保持し、短い文で示す。履歴数の増加によって、折りたたみ状態のツール位置が下へ伸び続けない。

### 日時の意味と識別

- このアプリの日時は有限・Date範囲内・正のtimestampのみを有効とする。`null`、空文字、不正文字列、`0`、`"0"`、負数、NaN、Infinity、範囲外、secondsが欠損したオブジェクトは `null` にする。任意の年の下限は設けない。
- 企画のlastOpenedAtが有効なら「最終閲覧」。なければupdatedAtで「最終更新」。両方なければ「日時不明」。閲覧日時を現在時刻や更新日時で捏造しない。
- フォームはcreatedAtで「作成 …」。欠損時は「作成日時不明」。欠損日時に `dateTime` 属性を付けず、ISO変換も実行しない。
- 企画は閲覧日時、なければ更新日時で降順。同時刻・日時なし同士はroomIdで安定順。フォームは作成日時降順、同時刻・日時なし同士はformIdで安定順。日時なしは末尾。
- 名称は現在の新旧保存形式統合を維持する。同名の別企画は日時を補助情報として区別する。名称から統合や削除を行わない。

### フォーム操作

- フォーム行は「フォーム名」「作成日時」「操作リンク」の順。名前自体は静的テキストとし、responseUrlがあれば「応募フォームを開く」を明示する。
- 安全なprojectUrlがあれば既存の「企画を開く」を並べる。長い文や狭い幅では操作リンクを折り返す。
- コピーは既存OverflowMenuに集約する。文言は「応募フォームのリンクをコピー」「編集用リンクをコピー」を保持し、それぞれ該当URLがある場合のみ表示する。
- リンクは新しいタブ、`noopener noreferrer`、フォーム名を含むアクセシブル名。行全体をclickable/buttonにせず、複数リンクやメニューを内包する対話要素を作らない。
- URL不足の行でも名前と日時を表示し、存在しないURLへの操作は出さない。既存のURL安全性検証、コピー成功Toastと失敗案内を維持する。

### Carbonによる表示

- 各論理セクションに独立した `Grid`/`Column` を使う。履歴は各ブレークポイントで全幅（sm=4、md=8、lg=16）。従来の履歴だけ75%/50%幅にする指定を除く。
- ツールは `Grid narrow` に各カード `Column sm={4} md={4} lg={4}`。smは1列、672px以上2列、1056px以上4列。縦横のカード間隔は `$spacing-05`（16px）。
- h1は `heading-03`、セクション・カード見出しは既存の `heading-compact-01`、説明は `body-01`、日時は `label-01`。名称は主色、説明・日時は副色、明示するフォーム操作はリンク色。
- 履歴は `ContainedList kind="on-page" size="lg"` を基準とし、複数行の内容に合わせ自然に高さを増やす。固定高、行の切り捨て、三点リーダーで必須情報を隠す指定は加えない。
- ツールのピクトグラム/文章の横並びは320pxでも保持する。Launchと長い説明が重ならない既存の右余白を維持する。カードの高さを本文に合わせる。
- ナビゲーションリンク、展開ボタン、メニューに見えるフォーカスを維持する。閉じた設定やメニューにTabが入らない既存動作を保つ。

### 公式指針と製品判断

- [Tile](https://www.carbondesignsystem.com/building-blocks/core/components/tile/guidelines#clickable)：ClickableTileは全体が遷移対象で、内部に別CTAを置かない。
- [Contained List](https://www.carbondesignsystem.com/building-blocks/core/components/contained-list/guidelines)：関連内容と行内操作を整理できる。lgは標準48pxだが、複数行の内容で高さは増える。
- [Grid](https://www.carbondesignsystem.com/building-blocks/foundations/2x-grid/overview)：sm/md/lgは4/8/16カラム。
- [Typography](https://www.carbondesignsystem.com/building-blocks/foundations/typography/overview)：業務操作にはproductive typeで階層を作る。
- 3件プレビュー、セクション順、日時フォールバック、上記の操作文言は今回の製品判断。
- MCP自動監査の「Theme不足」は既存Providerを見て除外済み。通知wrapper内には既にToastNotificationがあり、wrapperだけを理由に通知を作り直さない。

## ファイルと責任

| ファイル | 作業 |
|---|---|
| `src/portalHistory.js` | 日時の正規化、欠損保持、企画表示日時、安定ソート |
| `src/App.jsx` | 固定順序、3件プレビュー、独立展開、フォーム操作の明示 |
| `src/styles.scss` | Carbon Gridに合わせた余白・文字・履歴/リンク配置 |
| `tests/portal-history.test.mjs` | 日時・並び順・ID統合・無書込みの回帰テスト |
| `tests/portal-browser-smoke.cjs` | 件数・展開・データ更新・操作・Grid/長文の検証 |
| `tests/portal-focus-smoke.cjs` | 新規操作のキーボード/フォーカス検証 |
| `.github/workflows/quality.yml` | 既存CIに履歴単体テストのゲートを追加 |
| `tests/production-pages-smoke.cjs` | 原則既存を維持。DOM変更が影響する場合だけ同等の実表示確認へ調整 |

`ThemeToggle.jsx`、`public/form-maker/`、Apps Script、他リポジトリ、既存保存スキーマは変更対象にしない。

## Review Focus

1. 更新日時しかない旧企画で、欠損閲覧時刻が0になり更新日時を隠す：Task 1でnull/最終更新を固定する。
2. 別roomIdの同名企画や日時なし履歴が3件から漏れ、削除されたように見える：Task 1のID保持、Task 2の全件展開で検証する。
3. 部分破損・保存領域拒否・更新イベントが、全件消去やセクション移動を起こす：Task 1/2の単体・ブラウザで検証する。
4. 全件表示中の更新・折りたたみ・メニュー閉鎖でフォーカスが消える：Task 2/3のキーボード検証で固定する。
5. 320px、200%相当、長い日本語/空白なしURL、リンク不足のフォームで操作が重なる：Task 3/4の内容別・幅別検証で固定する。

---

## Task 1: 欠損日時を保持し、正しい表示日時と並び順を返す

**Files:** Modify `src/portalHistory.js`; Test `tests/portal-history.test.mjs`。

**Interfaces:**
- 既存 `normalizePortalDate(value) -> number | null` と `readProjectIndex(storage) -> { status, projects, errors }` を維持する。
- `projects[]` の `updatedAt`/`lastOpenedAt` は `number | null`。欠損値の0への変換をやめる。
- 新規 `getProjectDisplayDate(project) -> { timestamp: number | null, label: '最終閲覧' | '最終更新' | '日時不明' }`。Task 2の描画が使う純粋関数。
- 既存 `readFormIndex(storage)` の返却形を維持し、createdAtによる降順へ揃える。余分なフィールドと現在のID重複排除契約は保つ。

- [x] 実行前にcwd、dirty状態、AGENTS.md、origin/mainを確認する。現基準は `e746ad32f61ada86bf19d0e6b306ff87fa7b1160`。実行時にmainが進んでいれば差分を確認する。
- [x] `superpowers:using-git-worktrees`に従い適切な作業領域を用意し、`codex/portal-history-navigation-improvements`で作業する。本計画が未追跡なら必要な1ファイルだけ作業領域へ持ち込む。別の計画・証拠を混ぜない。
- [x] `keeps missing lastOpenedAt null and displays updatedAt` を追加。registryにupdatedAtだけを持つ企画を読み、`lastOpenedAt === null` と有効なupdatedAtをassertする。次の結果も固定する：

```js
assert.deepEqual(getProjectDisplayDate({ lastOpenedAt: null, updatedAt: 2000 }),
  { timestamp: 2000, label: '最終更新' });
assert.deepEqual(getProjectDisplayDate({ lastOpenedAt: null, updatedAt: null }),
  { timestamp: null, label: '日時不明' });
```

- [x] `normalizes absent and non-positive portal timestamps` を追加。0、"0"、負数、空白、不正文字、非有限/範囲外、空seconds、seconds=0はnull。正のnumber/numeric string/ISO/seconds/_secondsは有効。既存の正数fixtureを守る。
- [x] `keeps same-name projects separate and orders undated projects last` を追加。別IDの同名2件、同時刻2件、日時なし2件を混在させ、全IDと安定順をassertする。
- [x] `sorts form history by creation time without rewriting storage` を追加。日付順でない配列、同時刻、欠損日時、無効1件を読み、有効ID保持・安定順・partial状態・`storage.writes === 0`をassertする。
- [x] `node --test tests/portal-history.test.mjs` を実行し、新しいケースが現行の0変換/ソート等で失敗することを確認する。
- [x] 日時を仕様どおり正規化する。`maxDate`は有効値がないとnullを返すようにし、欠損を0へ戻さない。表示日時関数と安定ソートを実装する。source優先による名称統合は維持する。
- [x] `npm.cmd run test:history` を実行。全単体テストとApps Script bridge smoke成功、読取無副作用を確認する。
- [x] このタスクのソースとテストだけをstageしてコミットする（例：`fix: preserve missing portal history timestamps`）。

## Task 2: 固定順序と独立した3件プレビューを実装する

**Files:** Modify `src/App.jsx`, `tests/portal-browser-smoke.cjs`, `tests/portal-focus-smoke.cjs`。

**Interfaces:** Task 1の返却値と `getProjectDisplayDate` を使う。App内定数 `HISTORY_PREVIEW_LIMIT = 3`、状態 `showAllProjects`/`showAllForms`（boolean、初期false）を用意する。DOM IDは `project-history-list` と `form-history-list`。

- [x] 既存ブラウザfixtureに企画6件・フォーム5件を用意し、0/1/3/4件の境界ケースも別ケースで用意する。合成データは既存の隔離storageにだけ置く。
- [x] 初期順が常に `['最近開いた企画', 'ツール', '作成したフォーム']`、初期3件、展開後6/5件をassertする。片方を展開してももう片方は3件のまま、縮小後も元の全件データが保存されていることを確認する。
- [x] storage/visibility更新後も展開と順序が保持されるケースを追加する。履歴0件・部分取得・保存拒否でも4ツールが利用できることをassertする。
- [x] Tab→Enterで展開、Tab→Spaceで縮小、`aria-expanded`/`aria-controls`、縮小後のフォーカス保持をassertする。更新で展開ボタンが消えるケースでは対象見出しへフォーカスが移ることを検証する。
- [x] ビルド後に `npm.cmd run test:browser` を実行し、現行全件表示/旧セクション順のために新しいケースが失敗することを確認する。
- [x] `initialHistoryOrder`を除き、仕様の固定順でセクションを描画する。既存フォーム10件のUI sliceは3件プレビュー/全件表示へ置き換えるが、保存側の最新10件処理は変えない。展開ボタンのfocusを維持する。
- [x] Task 1の表示日時を用い、欠損行に `日時不明`/`作成日時不明`を描画する。有効日時だけにtime/dateTimeを付ける。表示のために現在日時を保存しない。
- [x] `npm.cmd run build`、`npm.cmd run test:history`、`npm.cmd run test:browser`を実行する。旧順序のassertだけを仕様へ変更し、既存URL/コピー/テーマ検証は残す。
- [x] このタスクの変更をコミットする（例：`feat: add bounded portal history previews`）。

## Task 3: フォーム行の操作を明示する

**Files:** Modify `src/App.jsx`, `src/styles.scss`, `tests/portal-browser-smoke.cjs`, `tests/portal-focus-smoke.cjs`。

**Interfaces:** `.project-title`は名前表示、フォームの `.history-link`は明示する応募フォームリンク、`.history-project-link`は対応企画リンク。OverflowMenuは既存のURLコピー処理を使う。

- [x] 応募URL+企画URL+編集URLがあるフォーム、応募URLだけ、編集URLだけ、URLなし、不安全なURLのfixtureを追加する。
- [x] 各行の可視文言「応募フォームを開く」「企画を開く」とURL/target/relが対応することをassertする。responseUrlのない行には応募リンクを出さず、編集URLがあれば編集用コピーだけを出す。
- [x] 明示リンクをEnterで開く操作、各行のOverflowMenu操作、コピーしたURLの行対応、Escape後のフォーカス復帰、コピー失敗の案内を検証する。複数行のメニューは同じ名前の別フォームでも混同しない。
- [x] 変更前のDOMで上記文言の検証が失敗することを確認する。
- [x] 名前を静的テキストにし、URLがある操作だけを明示リンクとして配置する。既存の安全なURL判定・企画閲覧時刻更新・コピー処理を再利用する。長文時は操作領域を折り返す。
- [x] 行全体をbutton/onClickにしない。Carbon MCPでContainedListのaction構造を確認し、リンクとメニューの対話要素を入れ子にしない。
- [x] `npm.cmd run build`と`npm.cmd run test:browser`を実行。既存の「title自体がリンク」というselectorを役割/対象へ変更し、URL検証や別フォームのコピー検証を削除しない。
- [x] このタスクの変更をコミットする（例：`feat: clarify portal form history actions`）。

## Task 4: Carbon Gridと文字の階層を整える

**Files:** Modify `src/App.jsx`, `src/styles.scss`, `tests/portal-browser-smoke.cjs`。

**Interfaces:** tools/企画履歴/フォーム履歴は別Grid。テストは既存 `toolLayouts`、各カードの矩形、本文・Launch・フォーカスの計測を継続する。

- [x] Carbon MCPの `code_search` でGrid/Column、ClickableTile、ContainedList、使用するButton/Link等の実際のAPIを確認する。`docs_search`でusage/type/gridを確認し、導入済みのexports/type定義と照合する。MCPとローカルの版差を記録する。
- [x] 実画面に長い日本語企画名、空白なし長文、同名企画、3行以上のツール説明/学務カード、リンク不足のフォームを用意する。スクリーンショット用データは合成とする。
- [x] 幅320/390/640（200%相当）/672/1056/1280で、ツール1/1/1/2/4/4列、48pxピクトグラムが文章左、Launch非重複、全幅履歴、横overflow≤1pxをassertする。640pxは狭い実効幅の検証であり、実際のブラウザzoom確認とは区別する。
- [x] 390pxの折りたたみ状態で企画数6→100へ増えても、ツール見出しの縦位置が変わらないケースを追加する。本文h1がheading-03の計算スタイルになり、フォームリンクの文字がはみ出さないことを確認する。
- [x] 古い75%/50%履歴幅やh1サイズ等による失敗を確認後、仕様のGrid/Columnを実装する。各Columnにsm/md/lgを指定する。ツール配置以外の独立情報を同じGridへ詰め込まない。
- [x] 余白はspacing-05、h1はheading-03、履歴はsize=lg、日時/リンク/名称の階層を実装する。既存の48px/Launch保護余白を残し、カードと行の高さは内容に追従させる。
- [x] `npm.cmd run build`と`npm.cmd run test:browser`を実行する。light/dark/system、Tab/Enter/Space/Escape、メニューの端切れ、可視フォーカス、画像と矩形の証拠を確認する。
- [x] Carbon MCP `code_audit` を対象差分へ使い、候補を公式docsと実装全体で判定する。既存ThemeProviderやToastを見落とした指摘を機械的に修正しない。
- [x] このタスクの変更をコミットする（例：`refactor: align portal navigation with Carbon grid`）。

## Task 5: CI・実ブラウザ確認・引継ぎ

**Files:** Modify `.github/workflows/quality.yml`; 必要な場合のみ `tests/production-pages-smoke.cjs`。本計画の実行記録を追記する。

**Interfaces:** `npm.cmd run test:history`をPR品質ゲートへ追加する。既存Pagesのbuild→deploy→production-smokeと、A版iframe/テーマ/履歴origin契約を維持する。

- [x] quality.ymlのnpm ci後に `Run history unit tests` / `npm run test:history` を追加する。既存のbuild/contract/browser/artifactを保持する。publish workflowやdependency lockの広い変更はしない。
- [x] 次の最終ゲートを実行し、成功した結果とSHAを記録する：

```powershell
npm.cmd run test:history
npm.cmd run build
node tests/deployment-contract.cjs
node tests/portal-history-origin-smoke.cjs
npm.cmd run test:browser
git diff --check
```

- [x] `npm.cmd run preview -- --host 127.0.0.1 --port 4176`で今回ビルドを表示し、サイドブラウザまたはChromeで実操作する。古いorigin/cache/別buildを表示していないことを確認する。
- [x] 390pxとPCで、合成履歴の3件→全件→3件、企画/フォーム独立展開、各フォームリンク/メニュー/コピー、長文、空/partial/unavailable、テーマ、Tab/Enter/Space/Escapeを確認する。テスト結果だけで実操作完了を代替しない。
- [x] 承認済み6項目の達成を自己レビューする。重大なデータ保持・URL・フォーカスの問題を残さず、未検証があれば対象と理由を記録する。
- [x] 実行指示がローカル実装までなら、差分・検証・実操作証拠を引き渡す。push/PRまで指示されていれば新しいPRを作り、作成したPRをこのチャットへattachする。
- [x] 実行指示に本番反映が含まれる場合、品質ゲート成功後にmainへ反映し、公開された同SHAのPages build/deploy/production-smoke成功を確認する。その後Chromeかサイドブラウザで公開URLを新しく読み込み、導線・テーマ・履歴展開を再操作する。
- [x] 公開確認のために実運用フォームへ回答を送信しない。既存ブラウザ履歴を合成データで上書きしない。合成履歴は専用の隔離コンテキストで検証する。
- [x] 合格記録に日時、branch/SHA、確認幅、各ゲート、操作結果、公開の有無を残す。今回のUI改善と、過去の応募同期の合格範囲を混同しない。

## 計画作成時の根拠と引継ぎ

- `origin/main`：`e746ad32f61ada86bf19d0e6b306ff87fa7b1160`。調査対象4ソースは主チェックアウトとorigin/mainで同一。
- `readProjectIndex`のmaxDateが欠損を0にし、`normalizePortalDate(0)`が有効値として扱われる。更新日時だけある合成企画でも表示日時がepochになることを実行で再現した。
- `App.jsx`は履歴ありで企画→フォーム→ツール、企画は全件、フォームはUI上10件を表示している。既存ブラウザテストにもこの旧順序のassertがあるため、Task 2で明示的に変更する。
- 既存ブラウザQAは320/390/640/672/1056/1280、light/dark/system、ピクトグラム位置、Launch非重複、コピー、フォーカスを検証する。再利用して今回の振る舞いを追加する。
- 品質CIは現状build/contract/browserで、history単体テストを実行していない。Task 5で今回の日時修正もPRの品質ゲートに含める。
- 以前の計画や合成本番データの削除は本書の作業ではない。無関係な証拠・計画をstageしない。

## Lunaへ渡す開始指示

「この計画書を読み、superpowers:executing-plansでTask 1から順に実装してください。既存の変更を保ち、Carbon MCPとcarbon-builderを使ってAPIを確認し、各タスクの検証を通してください。最後に今回ビルドを実ブラウザで操作して合否と差分を報告してください。公開範囲はこの実行指示で指定された範囲に従ってください。」

## 計画セルフレビュー

- [x] 承認済み6項目はTask 1〜4、検証とCIはTask 5で網羅。
- [x] 日時型、表示関数名、一覧ID、展開状態、文言、列数を固定。
- [x] 表示上限3件と保存側10件を区別し、無書込みと全件展開を検証。
- [x] 同名別ID・欠損日時・破損データ・更新時フォーカス・長文狭幅を各タスクへ割当。
- [x] 既存の応募連携付きA版、テーマ、履歴origin/ID統合、単一カードリンクを保護。
- [x] 実装を開始せず、Luna向けの計画のみ保存した。

## 実装・本番公開完了記録（2026-10-14）

- `codex/portal-history-navigation-improvements` の履歴・導線・Carbon改善をTask 1〜5の順に実装し、最終SHA `f8957fe6d013be6b7969572e7229b9b4cbef3f15` をmainへ反映。
- CI実行順の問題を修正：`test:history`内のApps Script Chromium smokeより先にChromiumを導入。最終 `Quality guard` run `38471606253` 成功。
- Pages run `38471606293` は同じSHAのbuild/deploy/production-smokeすべて成功。`pages-production-smoke` status成功を確認。
- 公開URL `https://mutoshiki.github.io/sanpokai-kikaku-portal/` をサイドブラウザで再読み込みし、3件プレビューと展開/折りたたみ、4ツール、応募フォームの明示リンク、ダークテーマ切替を操作。テーマ選択は元のシステム設定へ戻した。横overflowなし。ページ配信asset fingerprintは公開DOMと最終distで一致。
- production smokeは390pxでポータルのlight/dark、フォームホスト、埋込みApps Script UIを検証。独立のChromium UI suiteは320/390/640/672/1056/1280pxを検証。公開確認に実運用フォームへの回答送信は行っていない。