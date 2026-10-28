# 山歩会企画ポータル「続きから開く」改善実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 実装モデル・実行方法はユーザーの指定を引き継ぎ、モデル変更や委任を勝手に行わない。

**Goal:** スマートフォンで「企画を再開する」「応募フォームを開く・共有する」「新しい作業を始める」を短い操作で選べるポータルにする。

**Architecture:** 既存の `App.jsx` を画面と状態の所有者とし、履歴2種類をCarbon Tabsで同じ領域へまとめる。保存形式・Apps Script連携は維持し、表示用の識別処理だけを `portalHistory.js` に追加する。レイアウトは既存SCSSとCarbon Gridで修正する。

**Tech Stack:** React 19、導入済み `@carbon/react 1.115.0`、Carbon icons/pictograms、Vite、Playwright、Node test runner。

**Spec:** 本書「合意済み仕様」。2026-10-14のユーザー提供iPhone写真2枚と、直前の改善案への「いいね」を根拠とする。

## Global Constraints

- 計画作成時のHEADは `a1a6499`。実装開始時にbranch・remote・dirty state・適用されるAGENTS.mdを確認する。
- 未追跡の `.playwright-cli/` と既存計画書を含め、無関係な作業をreset/stash/削除/stageしない。本書は以前の計画書を上書きしない。
- 旧計画 `2026-10-14-portal-history-navigation-improvement-plan.md` の「企画→ツール→フォーム」と「コピーをすべて⋮に置く」は、本書の新仕様に置き換える。それ以外のデータ・安全なURL・履歴連携の契約は維持する。
- localStorageキー、保存件数上限、roomId/formIdによる同一性、日時の意味、新旧保存形式の読取、保存失敗時の動作を変えない。
- 名称による企画統合をしない。フォームのcreatedAtを企画の作成日時として使用しない。欠損日時を現在時刻・1970年で補わない。
- `public/form-maker/index.html` の確認済みApps Script endpoint、history/themeメッセージのorigin/channel検証、Googleフォーム応募同期を変更しない。
- Apps ScriptとFirebaseの変更・新しいフォーム作成・実応募者データの書込みはこのUI改善に不要。既存のアカウント運用はApps Script=`sanpokai.formmaker@gmail.com`、Firebase=`610unko@gmail.com`。
- 既存のThemePreferenceProviderを使う。system/light/dark、保存、親子連携を維持する。Carbon更新・新規依存は行わない。
- Carbon MCPと導入済みpackageのprops/exportsを確認してから編集する。MCPの現行例と導入版が違う場合は導入版で利用可能な公開APIを使う。
- 新たな `.cds--` 内部クラス上書き、固定行高による文章切捨て、フォーカス輪郭の一律削除、ClickableTile内の別CTAを追加しない。
- 本書の作成は計画のみ。実装や公開は開始しない。実装指示が本番公開まで含む場合、Task 5の公開検証まで完了して終了する。

## Review Focus

1. 非選択の履歴タブにTabキーが入らず、空・部分取得・取得不可でもタブを使えること。Task 1で検証する。
2. 同名・同じ表示日時・日時なしの別企画が混ざらず、間違った日付を表示しないこと。Task 2で検証する。
3. responseUrlなし・editUrlのみ・危険なURL・クリップボード拒否のフォームで、存在しない操作や成功表示を出さないこと。Task 3で検証する。
4. 長い日本語・空白なし文字列・320px幅で、ツールのピクトグラムと説明・遷移アイコン・行内操作が重ならないこと。Task 4で検証する。
5. storage更新で選択タブ・展開状態が戻らず、フォーカス中の行が消えた場合にも非表示パネルへフォーカスを送らないこと。Task 1とTask 5で検証する。

## 合意済み仕様

### 利用目的 → 操作 → 情報構造

利用目的は、最近の企画の再開、作成したフォームの利用・共有、ツールによる新規作業の3つ。

表示順は以下で固定する。

1. ヘッダー：既存ブランド名「山歩会企画ポータル」と歯車。
2. 本文h1：「企画を進める」。
3. h2：「続きから開く」。補足：「このブラウザに保存された履歴」。
4. 履歴タブ：「最近の企画」「作成したフォーム」。
5. h2：「ツール」と既存4枚のカード。

タブは初期「最近の企画」。利用者が切り替えたらstorage/visibility更新でも選択を維持する。ページ再読み込みでは初期タブへ戻す。空のタブも残す。追加のタブ選択保存キーは作らない。

各履歴の初期表示は3件。4件以上で「すべて見る」、展開後「表示を減らす」。企画とフォームの展開状態は独立し、タブ往復でも維持する。再読み込みは3件へ戻す。「すべて」は現在読取可能な保存履歴全件を意味し、失われた過去の履歴を復元しない。

### 履歴の表示・操作

- 企画行：企画名をリンクとして表示し、その下に既存の正しい日時を表示。lastOpenedAt→「最終閲覧」、updatedAt→「最終更新」、両方欠損→「日時不明」。リンクの新規タブ動作を維持する。
- 開催日・企画作成日は現行の正規化データにないので、本改修では追加しない。フォーム作成日から推測もしない。
- 同じ表示名かつ同じ表示日時で区別できない行に限り「企画ID: roomId」を追加。日付の表示精度は分単位なので、秒だけ違う行も対象とする。IDは全体を表示して折り返す。handoff等のトークンは表示しない。
- 識別情報は全件で計算してから3件へ絞る。プレビュー外の同名行があっても判定が変わらない。
- フォーム行：静的なフォーム名→作成日時→操作。安全なresponseUrlがある場合は「応募フォームを開く」「回答用リンクをコピー」。安全なprojectUrlがある場合は「企画を開く」。
- 「編集用リンクをコピー」は⋮に残す。responseUrlコピーの重複メニュー項目は除く。editUrlがない行には⋮を表示しない。
- responseUrlのない行には回答用操作を表示しない。editUrlのみの行では編集用メニューだけを表示する。フォーム行全体はクリック可能にしない。
- コピー成功Toast：「回答用リンクをコピーしました」。編集コピーの既存成功文言・コピー失敗の行内alertを維持する。
- 「応募フォームを開く」「企画を開く」は同じ文字サイズのCarbon body-compact-01相当。主要リンク・コピー・メニューは44px以上のタップ領域を確保し、狭い画面では折り返す。

### レイアウト・文章・テーマ

- ページ外側ガターはsm=16px、md以上=32pxを基準とする。h1、h2、タブ外枠、リスト外枠、ツールカード外枠の左端を揃える。行やカード内部の16px余白は別扱い。
- 二重のGrid/paddingで履歴だけさらに内側へずらさない。各論理グループには独立したGrid/Columnを使う。具体的なガター調整は公開propsと所有クラスで行う。
- ヘッダー下から本文h1までの余白は24pxを基準にする。主要グループ間は32px、見出しと本文は16px、カード間隔は16px。
- h1=heading-03、h2/カード名=heading-compact-01、説明=body-01、履歴日時・補足=label-01を基準とする。主要操作を日時より小さくしない。
- ツールは既存の左48pxピクトグラム＋右テキスト、現在の順序・URL・カード全体の単一遷移を維持する。sm1列、md2列、lg4列。高さは文章に応じて増やす。
- 説明文を以下へ変更する。

| ツール | 説明 | 補足 |
|---|---|---|
| 登山計画書メーカー | YAMAPの画像から登山計画書を作成 | なし |
| 応募フォームメーカー | 参加者を募集するGoogleフォームを作成 | なし |
| サークル企画ツール | 参加者・車割・班割・交通費を管理 | なし |
| 学務提出書類作成ツール | 引き継ぎデータから提出書類を作成 | PCアプリをダウンロード |

- 学務ツールの補足は静的テキストで、カード内に別リンクやボタンを置かない。aria-describedbyに説明と補足を含める。
- 歯車のアクセシブル名は「表示テーマ：現在の選択」、パネル名・legendは「表示テーマ」。system/light/darkの選択肢・歯車アイコン・保存キーは維持する。
- 写真の青枠はフォーカス表示に見える。輪郭を消すことを目的にしない。キーボードの可視フォーカスを維持する。タッチ起因の不適切なフォーカス復帰が再現した場合だけ、入力方法を判別して直す。

### 公式指針と製品判断

- [Tabs](https://carbondesignsystem.com/building-blocks/core/components/tabs/guidelines/#when-to-use)：関連情報をカテゴリに分け、同じ作業の中で切り替えられる。今回の履歴2タブ・初期選択は製品判断。
- [Tile](https://www.carbondesignsystem.com/building-blocks/core/components/tile/guidelines#clickable)：ClickableTile全体が遷移対象で、内部に別CTAを入れない。左ピクトグラムの構成と短い説明文は製品判断。
- [Header accessibility](https://carbondesignsystem.com/building-blocks/core/components/ui-shell-header/accessibility/)：操作の名前・キーボード操作・フォーカスを扱う。今回の「表示テーマ」への文言統一は製品判断。
- MCPでTabs/TabList/Tab/TabPanels/TabPanel、ClickableTile、ContainedListを確認済み。導入版でTabsのselectedIndex/onChange、TabListのactivation、ContainedListのisInset、OverflowMenuのsizeを確認済み。実装時は対象propsと実DOMを再確認する。

## ファイルと責務

| ファイル | 変更する責務 |
|---|---|
| `src/App.jsx` | 履歴タブ、表示順、フォーム操作、ツール説明、更新時のフォーカス |
| `src/styles.scss` | ガター整列、余白、主要操作の文字・タップ領域、折返し |
| `src/portalHistory.js` | 保存データを変更しない企画識別情報の算出 |
| `src/ThemeToggle.jsx` | 表示テーマの名称、再現した場合のみ入力方法別フォーカス復帰 |
| `tests/portal-history.test.mjs` | 同名企画の識別と日時契約 |
| `tests/portal-browser-smoke.cjs` | タブ、履歴状態、操作、レスポンシブの統合検証 |
| `tests/portal-focus-smoke.cjs` | タブ・テーマ・リンクのキーボード/タッチフォーカス検証 |
| `tests/portal-history-origin-smoke.cjs` | 画面変更後も履歴連携が表示されること |
| `tests/production-pages-smoke.cjs` | 新しいh1とタブ構造で公開画面を検証 |
| `.github/workflows/quality.yml` | WebKit検証を追加する場合のブラウザー導入 |

大規模なApp.jsx分割やテスト基盤の再設計は本計画に含めない。

## Task 1: 履歴をタブで集約し、上部の配置を揃える

**Files:** `src/App.jsx`、`src/styles.scss`、`tests/portal-browser-smoke.cjs`、`tests/portal-focus-smoke.cjs`、`tests/production-pages-smoke.cjs`、`tests/portal-history-origin-smoke.cjs`。

**Interfaces:** App内の `historyTabIndex: 0 | 1`。Carbon Tabsの `selectedIndex` と `onChange({ selectedIndex })` を利用。テスト内に `selectHistoryTab(page, label)` を追加し、選択されたtabpanelが可視になるまで待つ。既存のshowAllProjects/showAllFormsは独立状態として維持する。

- [ ] 既存ブラウザーテストに、h1=`企画を進める`、h2の順=`続きから開く`→`ツール`、初期選択=`最近の企画`、タブ往復後の独立した3件/全件表示、空・部分取得・取得不可の検証を追加し、未実装で失敗することを確認する。
- [ ] `Tabs`→`TabList`/`Tab`→`TabPanels`/`TabPanel`の公式構成で既存2一覧を包む。`activation="automatic"`を使い、非選択パネルのリンク・ボタンへTabが入らないことを確認する。空でも自動でタブを切り替えない。
- [ ] 本文見出しと補足を変更し、タブ領域をツールの前へ置く。各Gridの外枠左端を揃え、ページ余白の二重適用を除く。
- [ ] 既存の更新時フォーカス復帰をタブ構造に合わせる。フォーカス中の要素が更新で消えたら、その時点で選択されている履歴パネル内の名前付き見出し（tabIndex=-1）へ戻す。非選択パネルへ移さない。タブ選択・展開状態を更新で戻さない。
- [ ] 既存の旧h1・セクション順を前提とするテストを新仕様へ更新する。フォームのテストでは必ずフォームタブを選択し、非表示DOMだけを見て成功としない。
- [ ] `npm run build` → `npm run test:browser` → `node tests/portal-history-origin-smoke.cjs`を実行し成功を確認する。
- [ ] 対象ファイルだけをcommitする。推奨: `feat: group portal history into resume tabs`。

## Task 2: 同名企画の識別を補う

**Files:** `src/portalHistory.js`、`src/App.jsx`、`tests/portal-history.test.mjs`、`tests/portal-browser-smoke.cjs`。

**Interfaces:** `getProjectDisambiguators(projects) -> Map<string, string>` をexportする。キーはroomId、値は `企画ID: ${roomId}`。表示名・日時ラベル・分単位の表示日時が重複する企画だけを返す。既存 `getProjectDisplayDate(project)` を利用し、元の配列/要素/storageを変更しない。

- [ ] ユニットテストを追加する。`同名・同分日時の別roomId`と`同名・日時なし`は両方のIDが返る。`同名・異なる分の日時`と`異名・同日時`は返らない。秒だけ違う同分日時は重複として扱う。欠損名の表示名は既存の「名称未設定の企画」に合わせる。入力が変更されないこともassertする。
- [ ] `node --test tests/portal-history.test.mjs`で追加テストが失敗することを確認し、表示用helperを実装する。
- [ ] 全件から識別Mapを算出してからプレビューを適用し、必要な行の日時の下に識別情報を表示する。長いIDは折り返す。
- [ ] 既存の時刻正規化・安定順・名称統合のテストも含め、`npm run test:history`を実行する。ブラウザーテストでは同名行を開き、それぞれ違うroomへ遷移することを検証する。
- [ ] 対象ファイルだけをcommitする。推奨: `fix: distinguish ambiguous portal project entries`。

## Task 3: フォームの共有操作を直接表示する

**Files:** `src/App.jsx`、`src/styles.scss`、`tests/portal-browser-smoke.cjs`。

**Interfaces:** 既存 `copyLink(url, message, errorId)`、`safeExternalUrl(value)`、`safeProjectToolUrl(value)`を再利用。responseUrlのコピーラベルは `回答用リンクをコピー`、成功文言は `回答用リンクをコピーしました`。編集用ラベルは既存 `編集用リンクをコピー`。

- [ ] フォームタブで、回答URLあり・回答URLのみ・企画URLのみ・編集URLのみ・URLなし・危険なURLを検証するテストを更新する。回答コピーは直接ボタン、⋮は編集URLのある行だけ、回答コピーの重複メニューはゼロとassertする。
- [ ] 新しい直接コピーを既存のcopyLinkへ接続する。可視文言は短く、アクセシブル名にはフォーム名を含める。コピー/⋮のクリックやEnterで外部タブが開かないことをassertする。
- [ ] 「応募フォームを開く」「企画を開く」の文字を同じサイズに揃え、主要操作のタップ領域を44px以上にする。コピーButtonとOverflowMenuは導入版で確認した公開size propsを使用し、狭い幅は自然に折り返す。
- [ ] コピー成功時の値がresponseUrlと一致し、拒否時は成功Toastなし・行内alertあり、編集コピーはeditUrlと一致することを検証する。コピー後フォーカスは押した操作に残す。
- [ ] `npm run build` → `npm run test:browser`を実行し成功を確認する。
- [ ] 対象ファイルだけをcommitする。推奨: `feat: expose form response link copy action`。

## Task 4: ツール文章と表示テーマの表記を整理する

**Files:** `src/App.jsx`、`src/styles.scss`、`src/ThemeToggle.jsx`、`tests/portal-browser-smoke.cjs`、`tests/portal-focus-smoke.cjs`、`tests/production-pages-smoke.cjs`。

**Interfaces:** 既存TOOLSに任意の `downloadHint` を追加して学務ツールだけに指定する。各カードのaria-describedbyは実際に存在する説明/補足IDを参照する。ThemeHeaderControlの公開名は `表示テーマ：${currentLabel}`。

- [ ] TOOLSの文章を仕様表へ変更し、学務ツールの補足を静的テキストで追加する。ピクトグラム・順序・href・target・relを維持する。
- [ ] ガター・見出しと本文の余白・カード内文字をトークンで統一する。320pxで長い日本語や空白なし文字列を追加したQA fixtureを使い、カード外枠幅、文章幅、Launchとの重なり、横スクロールを検証する。
- [ ] ThemeHeaderControlとテストの名称を「表示テーマ」に統一する。ラジオの選択肢と保存値は変えない。
- [ ] フォーカステストで、キーボードから開いたテーマパネルをEscapeで閉じた時のトリガー復帰・可視輪郭、タッチから閉じた時の挙動を確認する。青枠が残るだけで不具合と判定しない。無条件blurや全体outline:noneを入れない。
- [ ] `npm run build` → `npm run test:browser`を実行し成功を確認する。
- [ ] 対象ファイルだけをcommitする。推奨: `style: simplify portal tool copy and theme labels`。

## Task 5: 統合確認・公開時の実ブラウザー合格判定

**Files:** `tests/portal-focus-smoke.cjs`、`.github/workflows/quality.yml`、`tests/production-pages-smoke.cjs`。必要な検証修正以外は変更しない。

**Interfaces:** フォーカス検証をChromiumとWebKitの両方で実行し、結果・スクリーンショットのファイル名にbrowser名を入れて証拠を上書きしない。Chromium専用args/executable/envをWebKitへ渡さない。

- [ ] フォーカステストをChromium/WebKitのループへ拡張し、両テーマでタブの矢印操作、選択tabpanelのTab順、非選択tabpanelへ入らないこと、テーマのEscape復帰を検証する。Quality guardのブラウザー導入を `npx playwright install --with-deps chromium webkit`へ更新する。
- [ ] 最新sourceをbuildしてから、順に `npm run test:history`、`npm run test:browser`、`node tests/portal-history-origin-smoke.cjs`、`node tests/deployment-contract.cjs`、`git diff --check`を実行する。必要なブラウザーは公式Playwrightから導入する。失敗をテスト条件の緩和で隠さない。
- [ ] 新鮮なローカルpreviewをChromeで操作する。320px/390px/1280px、light/dark/system、履歴なし/3件/4件以上/長名/同名/読取失敗を検証する。ユーザーの実履歴を上書きせず、テストの隔離fixtureを使う。
- [ ] 実操作: タブを往復→各一覧を展開/縮小→フォームを開く→回答用コピー→編集コピー→企画を開く→表示テーマを変更する。元ポータルタブが維持されること、意図したURLだけに遷移することを確認する。
- [ ] 対象ファイルだけをcommitする。推奨: `test: verify portal resume workflow across browsers`。
- [ ] 実装指示に本番公開を含む場合のみ、通常のGitHub Pages経路で公開する。最新mainのQuality guardとDeploy Pagesのproduction-smoke成功を確認する。今回のUI改修のためにGAS endpointを再変更しない。
- [ ] 公開後にChromeで公開URLを読み直し、履歴2タブ・ツールカード遷移・テーマ保存・元タブ維持を実操作する。既存の合成テスト履歴がある場合はコピーと企画遷移も確認する。空状態しか確認できない操作を「検証済み」にしない。新しいフォームや応募はこの確認のために作らない。
- [ ] 手動確認画像を保存して提示し、公開commit・Actions結果・確認できた操作・残る制限を簡潔に報告する。iPhone実機を操作していなければ「WebKit/Chromeの390px検証」と明記し、Safari実機確認と混同しない。

## 完了条件

- 履歴はツールより前に1領域として置かれ、企画とフォームをタブで切り替えられる。
- 3件プレビュー、独立した展開状態、正しい日時・企画同一性・履歴連携を維持する。
- 回答用リンクを1操作でコピーでき、URL不足やコピー失敗が正しく表示される。
- 見出し/一覧/カードの外枠左端が揃い、320pxでも横スクロールと操作の重なりがない。
- ツールのピクトグラム/順序/URL/単一クリック構造を維持し、説明は仕様表と一致する。
- キーボードのフォーカスとテーマ選択が正しく、非表示パネルに操作が入らない。
- 公開を含む実行では、公開URLの実ブラウザー操作まで合格して初めて完了とする。

## 計画の自己確認

- 改善案の6項目をTask 1〜4へ割当済み。公式指針と製品判断を分離した。
- 現行データから取得できない開催日・企画作成日は追加せず、日時の誤表示を避けた。
- 非選択タブ、独立展開、更新中のフォーカス、コピー失敗、同名同日時、長い文字列を各担当タスクに割当済み。
- 旧テストがフォームパネルを常時可視とみなす前提と、旧h1を待つ前提を更新対象として明記した。
- 既存Apps Script連携とFirebase応募同期の修正を今回の計画へ混ぜていない。
