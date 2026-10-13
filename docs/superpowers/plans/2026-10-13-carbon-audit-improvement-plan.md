# Carbon公式ガイドに基づく評価・改善計画書

> **実装記録（2026-10-13）：** ユーザーの実装指示を受け、Task 1〜8を実施した。実行結果と未取得の外部仕様を「実装結果と残る範囲」に記録し、各タスクのチェックを更新した。変更はローカルの未コミット状態で保持し、push・公開はしていない。

**Goal:** 履歴が正しく表示され、初めての利用者も継続利用者も目的のツールに迷わず移動できる、Carbonに沿ったポータルに改善する。

**Architecture:** 現行のReact / Carbonコンポーネントを基本にする。企画履歴は旧保存形式と現行React保存形式を読み取る互換処理と、企画ツールが明示的に記録する閲覧履歴を組み合わせる。フォーム履歴は既存のiframe連携を維持し、統合処理と入口をそろえる。

**Tech Stack:** React 19、`@carbon/react`、Carbon icons / pictograms、SCSS、Vite、localStorage、Google Apps Script iframe。

**Spec:** 本書「評価と採用仕様」が仕様。ユーザー要件は「情報の優先順位・操作・見た目・アクセシビリティ・ロジックをCarbon MCPで評価し、公式指針と判断、採用・不採用理由を分けて、今回は計画書だけを作る」。

## 全体制約

- 計画作成時は成果物をこの計画書に限定した。後続の明示的な実装指示を受けたため、今回の作業ではソースとテストを変更した。
- 後続の実装モデルはgpt-6-luna。新しいチャットやサブエージェントを今回開始しない。
- 現行の4ツールと既存の履歴データを引き継ぐ。roomId / formIdを安定した識別子として扱う。
- ポータルの既存依存関係とpackage-lockを基本にし、履歴修正のための新規ライブラリは追加しない。
- 企画ツールとの連携は同一オリジン・同じブラウザ保存領域で成立する。別ブラウザ・別端末の履歴同期は今回の仕様に含めない。
- 他リポジトリの変更が必要なタスクは、対象のチェックアウトとAGENTS.mdを確認してから実施する。Apps Scriptの未取得ソースを推測して変更しない。
- フォーム作成、編集者招待、実データの送信を伴う確認は、テスト用のデータと対象環境が明示された後に実施する。
- デプロイ・push・本番の変更は後続の明示的な指示を受けて行う。

## 評価範囲と証拠

- 評価日：2026-10-13。ポータルのローカル基準：`a32d0a0`。
- 公開ポータル、テーマ設定、フォーム履歴の操作メニュー、フォームメーカーの入力画面をサイドブラウザで確認した。
- ポータルは狭いサイドブラウザ表示と1280px表示を確認した。フォームメーカーの狭い幅への変更は撮影・寸法確認に失敗したため、モバイル確認済みとは扱わない。
- 企画ツールの既存タブでは、企画名が入力された現行React画面と、`assets/index-D3AtY1F8.js`の読み込みを確認した。ポータルでは「最近開いた企画」が空だった。
- 監査開始時はフォーム履歴が空だったが、途中で作成済みフォーム1件が表示された。フォーム履歴の常時全欠落を再現したとは言えない。
- Carbon MCPの`docs_search`、`code_search`、`code_audit`を使用。4ファイルの自動監査は32件の候補を返した。候補はコードと公式例を照合し、下記で採否を判断した。
- 今回取得したポータル／フォーム入口のコンソールログにerror・warnはなかった。履歴不具合がないことを意味するものではない。
- 別リポジトリの公開ソースは`mutoshiki/circle-kikaku-tools`の`e5e82800eef36e1bf85f0484aebcfcc25c83b1aa`を参照。後続実装時は最新版とデプロイ版を再確認する。
- 指定されていた`carbon-builder`のSKILL.mdは、指定パスとこの環境のスキル領域で見つからなかったため、Carbon MCPと公開公式ガイドを直接使用した。

スクリーンショットはリポジトリ外の `C:/Users/としき/.codex/visualizations/2026/10/13/01a133d6-7571-75a2-a3af-68ec3b91cd7d/carbon-audit/` に保存。次の5枚を確認済みの証拠とする。

| 手順 | 確認した画面 | 評価 | 証拠ファイル |
|---|---|---|---|
| 1 | 狭い幅のトップページ | 4ツールの内容は読める。履歴への到達にはスクロールが必要 | `01-portal-narrow.png` |
| 2 | テーマ設定パネル | 開く操作はできる。Escape・非表示時のフォーカスに問題 | `02-theme-panel.png` |
| 3 | 1280pxのトップページ | 4列は成立するが説明文が細く折り返され、履歴の右側に広い余白 | `03-portal-desktop.png` |
| 4 | ダークテーマとフォーム履歴1件 | 色の切替と1件の表示は成立。最近の企画は空 | `04-portal-dark.png` |
| 5 | フォームメーカー入口 | 入力ラベルと必須・任意は明示。作成処理は実行していない | `05-form-maker-entry.png` |

## Carbonの公式指針

以下の指針は公式の記述。具体的なツール順、保存キー、統合アルゴリズム、製品内の文言は本書の製品判断である。

| ID | 公式の指針 | このサイトへの適用 |
|---|---|---|
| C1 | [Clickable tile](https://www.carbondesignsystem.com/building-blocks/core/components/tile/guidelines#clickable)はページへの移動に使える。タイル全体が操作対象であり、内部に独立したCTAを置かない | 現在の4ツールへの入口は用途に適合。装飾ピクトグラムと右下の移動アイコンを維持 |
| C2 | [Contained list](https://www.carbondesignsystem.com/building-blocks/core/components/contained-list/guidelines)は同じ構造の関連項目をまとめ、行内リンク・アクションを置ける。複雑な多列情報はData table等を検討 | 名称・日時・少数アクションという現在の履歴に適合。Data tableへの全面置換は不要 |
| C3 | [Empty states](https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states)は空である理由、入る情報、次の操作を示す。未作成とシステムの問題を区別する | 履歴なし・取得不可・部分的に読めた状態を区別し、次の操作を示す |
| C4 | [右パネルのアクセシビリティ](https://www.carbondesignsystem.com/building-blocks/core/components/ui-shell-right-panel/accessibility#keyboard-interaction)ではキーボード操作とEscapeでの閉鎖が説明されている | 本サイトの設定パネルにも開閉とフォーカス管理を適用。ただし公式のアプリ切替用ナビゲーションをラジオ設定へそのまま移植する判断ではない |
| C5 | [Typography](https://www.carbondesignsystem.com/building-blocks/foundations/typography/overview)はサイズ・太さ・行間で情報の階層を作り、製品にはproductive typeを使う | ツール名と説明文の階層、複数行の日本語の読みやすさを改善 |
| C6 | [2x Grid](https://www.carbondesignsystem.com/building-blocks/foundations/2x-grid/overview)は一貫した余白・列・基準線を作る。標準ブレークポイントに加え、用途に応じた独自設定も認める | 列数そのものより、内容の幅・位置合わせ・余白の一貫性で判断 |
| C7 | [Notification](https://www.carbondesignsystem.com/building-blocks/core/components/notification/guidelines#dismissal)は状態変化へのフィードバックを提供する。Toastは既定で保持され、5秒での自動消去も例示される | コピー失敗を無言で終えず、成功通知の表示時間と読める代替のフィードバックを整える |

## 評価と採用仕様

P1は履歴の信頼性とキーボード操作を妨げる問題、P2は操作・情報理解を改善する問題、P3は保守性改善または未取得の外部ソースに依存する項目。各項目の「判断」はこのサイトへの評価であり、Carbonが個別の保存設計を指定しているという意味ではない。

### P1-1：企画履歴の現行保存形式に対応する

**事実：** ポータル`src/App.jsx:25–30, 104–135`は旧形式の保存キーを列挙する。現行企画ツールの`apps/react/src/store/local-storage.js`は`sanpo-react:v1:<encodeURIComponent(roomId)>:room`に保存する。現行の`services/url-compat.js`と`runtime.js`には、旧runtimeにあった`syawari_last_opened_at_<roomId>`の記録処理が見当たらない。新形式の企画がポータルの一覧に入らない説明になる。

**公式：** C3は、情報を取得できない状態を正常な「履歴なし」と区別することを支える。保存キーの互換処理自体は製品の実装判断。

**採用：** ポータルに新旧両形式の読取を追加し、企画ツールが閲覧時刻と最小限の索引を記録する。読取対象はReactの`:room`レコードだけとし、`:clientId`等を企画として扱わない。旧データを破棄せず、roomIdで統合する。

**理由：** 最新保存データと一覧の接続を回復し、直接開いた企画も「最終閲覧」として正しく扱うため。ポータル単独では「閲覧した時刻」を復元できないので、書込側のタスクも必要。

### P1-2：フォーム履歴の入口・重複統合・10件制限を修正する

**事実：** `public/form-maker/index.html:115–121, 185–191`では、初回`history-ready`時に保存済み配列を先頭に置き、重複排除後に10件で切る。保存済み10件があると、子から届いた新規履歴が末尾で落ち得る。同じformIdの更新も配列の優先順に左右される。現行企画ツール`apps/react/src/components/AppHeader.jsx`のフォームメーカーリンクはApps Script直リンクで、ポータル側のiframe履歴連携を通らない。

**公式：** C3は、利用者がデータの有無と状況を理解できるようにする指針。マージ規則と入口の統一は製品判断。

**採用：** 全件をformIdで統合し、日時で並べ替えた後に最新10件を残す。重複時は有効な更新日時が新しいレコードを優先し、同時刻では今回受信したレコードを優先する。関連アプリのリンクを公開ポータルの`/form-maker/`へ変更する。

**理由：** 現在の「既存10件が新規履歴を押し出す」挙動を防ぐため。上限を撤廃するだけでは並び順や更新競合を解決できないので不採用。直リンクで過去に作った全履歴を必ず復元できるかは、Apps Script側の履歴提供仕様の追加確認が必要。

### P1-3：履歴読取の副作用・古い名称の上書き・日時例外を取り除く

**事実：** `readProjects()`は読むたびに`savedAt: Date.now()`を含めて索引を書き、全`storage`イベントで再度呼ばれる（`src/App.jsx:147, 230`）。ポータルが2タブあると索引更新が相互に続く可能性がある。名称はデータの新しさによらず後から読んだ値で上書きされる（同:95–100）。有限の巨大数は`toTimestamp()`を通過し、描画の`toISOString()`でRangeErrorを起こし得る（同:384）。例外時には両履歴がまとめて空へ戻される（同:218, 224）。

**公式：** C3。これらのアルゴリズムの欠陥はコードからの判断。

**採用：** 読取を無副作用にし、索引への保存は内容が変わった時だけ実行する。通知対象のキーを絞る。名称は更新日時が新しい有効データを優先する。日時はDateとして有効な範囲を検証し、不正な1件で一覧全体が落ちないようにする。閲覧時刻がなく更新時刻を代用する行は「最終更新」と表示する。

**理由：** 更新ループ・名前の巻き戻り・一部データによる全件消失を避けるため。「最終閲覧」を推測で表示し続ける案は、利用者に違う意味の日時を伝えるので不採用。

### P1-4：テーマ設定のフォーカスと開閉を修正する

**実画面で確認：** Escapeでパネルが閉じない。閉じた設定ボタンからTabで、幅0のパネル内のラジオへ移動する。選択直後も画面外のラジオにフォーカスが残る。矢印キーで選択を変えると即座に閉じ、3つの選択肢を続けて操作できない。

**公式：** C4。閉じたパネルから操作可能な内容を除外し、キーボードの操作位置を明確にする必要がある。

**採用：** 選択変更ではパネルを閉じず、Escape／設定ボタンで閉じる。閉じた後は設定ボタンへフォーカスを戻す。非表示の内容はunmount、hidden、inert等でTab順とアクセシビリティツリーから外す。`aria-hidden`だけで済ませない。ボタンの`aria-controls`とパネルのidを対応させる。

**理由：** 実際に再現した操作不能・見えないフォーカスを解決するため。独自のonKeyDownをCarbonの履歴行へ一律に追加する案は、標準のEnter／Space操作を二重実行し得るので不採用。

### P2-1：履歴の移動先と失敗時の操作を明示する

**事実：** 「作成したフォーム」の行を押すと応募フォームではなく企画ツールが開く。操作メニューはリンクのコピーだけ。行のアクセシブル名にも移動先・新しいタブが含まれない。コピー失敗は通知されない（`src/App.jsx:246–269, 307–354`）。

**公式：** C2は行内リンクと複数アクションを許容し、C7は即時フィードバックを勧める。

**採用：** フォーム名は応募フォームへの通常のリンクにし、「企画を開く」を別の明示的なリンクにする。企画履歴も実hrefを持つリンクにし、移動先と新しいタブを読み上げ名で示す。コピー用OverflowMenuは維持する。成功は5秒表示、失敗は「コピーできませんでした。もう一度お試しください」とその操作の近くに保持する。エラー時に成功Toastを出さない。

**理由：** 見出しと遷移先の食い違いを解消し、ブラウザのリンク操作を使えるようにするため。リンクのない行は説明だけを表示し、押せそうな行にしない。

### P2-2：履歴を使う人と初めて使う人の情報順を整える

**事実：** 狭い表示では4枚の説明を読んだ後にフォーム履歴、企画履歴へ到達する。履歴の空表示は「ありません」のみ。

**公式：** C3は次の操作の案内を求める。C5・C6は情報の階層を支えるが、Carbonはこのサイトのセクション順を指定していない。

**採用：** 有効な履歴がある場合は「最近開いた企画」→「作成したフォーム」→「ツール」の順にする。初回はツールを先に表示する。セクションの見出しをh2として提供する。初回の空表示に「上の『サークル企画ツール』で企画を開くと、ここに表示されます」等の短い次の操作を添える。取得不可は「履歴を読み込めませんでした」と再読込操作を表示する。

**理由：** 継続作業を再開する導線を短くし、初回の利用者には入口を優先するため。自動でセクション順が入れ替わるのは初回読込時だけとし、フォーカス中の動的更新では順序を固定して操作位置の移動を避ける。

### P2-3：タイルの文字階層・説明・ダウンロード先を整える

**事実：** タイル名と説明はどちらも14px・400・約18px行間。1280pxの4列では文字領域が狭く、説明が細かく折り返される。学務提出ツールの移動先はWebアプリではなくGitHub Releases。

**公式：** C1・C5・C6。4列という数だけでCarbon違反とは判断しない。

**採用：** ツール名を`heading-compact-01`、複数行の説明を`body-01`で区別する。ピクトグラムは維持し、説明を次の文言に短縮する。タイルの説明を`aria-describedby`でリンクの説明として参照可能にする。

| ツール | 説明文 |
|---|---|
| 登山計画書メーカー | YAMAPの画像と基本情報から登山計画書を作成します。 |
| 応募フォームメーカー | 参加者を募集するGoogleフォームを作成します。 |
| サークル企画ツール | 参加者の車割・班割と交通費の精算を管理します。 |
| 学務提出書類作成ツール | 引き継ぎデータから学務提出書類を作成します。GitHubでアプリをダウンロードできます。 |

**理由：** 初見で用途と移動先を理解しやすくするため。列数はまず既存の1／2／4列で短縮後を確認し、文字が読めるかで判断する。大きな装飾画像、タイル内部の追加ボタン、固定サイドバーは今回の4ツールの入口には操作・余白を増やすため不採用。

### P2-4：フォーム入口に見える復旧導線を作る

**事実：** 外側HTMLの復旧リンクは`z-index: -1`でiframeの後ろに置かれている（`public/form-maker/index.html:42–50`）。iframeが正常表示した画面は確認できたが、読み込み失敗時の復旧は確認していない。フォーム内の編集者メール欄には、何に使われるかの説明が見えない。

**公式：** C3は問題に対して次の操作を示すことを勧める。

**採用：** 見える位置に「フォームメーカーを直接開く」を置く。初回読み込みが10秒続いたら「読み込みに時間がかかっています」と案内する。iframeのloadだけで成功判定せず、既存の有効な`history-ready`を到達確認に使う。後から準備完了したら遅延案内を解除する。編集者メール欄の用途説明は、Apps Scriptの実際の招待・権限仕様を確認してから追加する。

**理由：** iframeが使えない場合にも利用者が先へ進めるため。直接開く経路の履歴がポータルに必ず残るとは保証せず、その制約を短く案内する。

### P3：トークン整理・iframeテーマ連携・通知元の検証

**採用する保守改善：** SCSSの16／24／32px相当の余白、見出しのfont-weight、42rem／66rem等を意味の合うCarbonトークン・mixinへそろえる。これは現値が見た目として間違っているという意味ではない。

**外部ソース取得後に検討：** ホストのテーマ保存イベントはiframeのsrcを更新して再読込する（同:164–170）。入力中の再読込は避けるべきだが、子側のテーマ受信APIと下書き保持仕様は未取得。子側API確認後、テーマ通知による更新へ移す。入力消失は今回再現していないので断定しない。

**追加の実装判断：** postMessageのchannel確認に加え、通知元origin・送信元の検証を整理する。Google Apps Scriptは多重iframeであるため、`event.source === frame.contentWindow`だけを条件にする案は正規の子からの通知まで遮断し得るので不採用。子側ソースと実際の通知元を確認してから条件を決める。

## 維持する点と、自動監査の不採用理由

| 対象／候補 | 判断 | 理由 |
|---|---|---|
| ClickableTile、ContainedList、OverflowMenu、公式pictogram | 維持 | C1・C2の用途と一致。問題は用途説明・履歴連携・設定パネルの制御にある |
| ライト／ダークの基本色 | 維持 | 実測のタイル文字はライト16.45:1／7.10:1、ダーク13.76:1／8.86:1。確認した通常文字の組合せは良好。全状態の適合判定ではない |
| 「Themeがない」 | 不採用 | `main.jsx`のProviderから`GlobalTheme`と`CarbonTheme`が与えられている |
| 「SkipToContentがないので本文への移動がない」 | 不採用 | 独自の「本文へ移動」リンクが存在する。標準コンポーネントへの整理は可能だが、機能不存在とは言えない |
| 「Contentがないので本文がHeaderの裏になる」 | 不採用 | 現在のmainにはHeaderを考慮した上余白があり、確認画面で重なっていない |
| 「ContainedListItemにonClickだけなのでキーボード操作できない」 | 不採用 | Carbon公式例に同じonClick＋action構造があり、実DOMもbuttonだった。今回のリンクへの整理は遷移先を明確にするため |
| 「独自通知を使っている」 | 不採用 | `toast-host`は配置用の親で、中身はCarbon `ToastNotification` |
| 「42rem／66rem／99remや2列は規格外」 | 数値だけによる違反判定は不採用 | 42／66／99remは標準の672／1056／1584pxに一致。トークン化の保守提案と、内容に合うレイアウトの評価は別 |
| 履歴をData tableに置換 | 不採用 | 名称・日時・少数アクションだけなのでContainedListが適切 |
| 端末をまたぐクラウド履歴同期を追加 | 今回は不採用 | 認証・保存先・権限の別設計が必要。現在の同一ブラウザで起きる欠落の修正を先に行う |

## 実装時のレビュー重点

1. 旧形式とReact形式の両方があるroomId：最新名称を1行にまとめ、古い名称へ戻らないこと（Task 1）。
2. 既存フォーム履歴10件＋受信した新規1件：新規が先頭に入り、最古が落ちること（Task 3）。
3. ポータル2タブ：一度のデータ変更で索引の再書込が無限に続かないこと（Task 1／8）。
4. 保存禁止・壊れたJSON・巨大な日時：読み取れる行は残り、問題が「履歴なし」に隠れないこと（Task 1／3）。
5. 閉じたテーマパネル：非表示ラジオへのTab移動がなく、Escape後のフォーカスが見えること（Task 4）。

## ファイルと責務

| 対象 | ファイル | 責務 |
|---|---|---|
| ポータル・新規 | `src/portalHistory.js` | 新旧企画履歴の読取・日時正規化・索引保存・イベントキー判定 |
| ポータル・変更 | `src/App.jsx` | 状態表示、履歴リンク、セクション順、コピー通知 |
| ポータル・変更 | `src/ThemeToggle.jsx` | 設定パネル開閉とフォーカス |
| ポータル・変更 | `src/styles.scss`、`index.html` | タイポグラフィ・余白・静的フォールバックの内容一致 |
| フォームホスト・新規 | `public/form-maker/history-utils.js` | ブラウザとNodeで読めるES moduleの履歴統合関数 |
| フォームホスト・変更 | `public/form-maker/index.html` | ES moduleとして統合関数を読み込み、履歴通信と復旧表示を制御 |
| ポータル・新規テスト | `tests/portal-history.test.mjs`、`tests/form-history.test.mjs` | 互換読取、日時、統合、書込副作用の回帰 |
| ポータル・変更／新規テスト | `tests/portal-focus-smoke.cjs`、`tests/portal-browser-smoke.cjs`、`tests/portal-history-origin-smoke.cjs` | キーボード、更新後の表示、実オリジンでの2タブ更新 |
| 別リポジトリcircle・新規 | `apps/react/src/services/portal-history.js`、`apps/react/tests/portal-history.test.mjs` | 閲覧時刻と最小索引の記録 |
| 別リポジトリcircle・変更 | `apps/react/src/runtime.js`、`apps/react/src/components/AppHeader.jsx` | 閲覧記録の呼出とフォーム入口の統一 |

履歴レコードは既存の索引形状 `{version:1, projects:[{roomId,name,updatedAt,lastOpenedAt}]}` を互換契約にする。参加者・精算情報を索引に複製しない。

## 実装タスクと確認条件

以下のチェック項目は今回実施した内容を示す。P1から順に実装し、P2の画面・復旧状態を続けて適用した。

### Task 1：企画履歴読取と更新処理を修正する（P1-1／P1-3）

**Files:** `src/portalHistory.js`新規、`src/App.jsx`変更、`tests/portal-history.test.mjs`新規。

**Interfaces:** `normalizePortalDate(value) -> number|null`、`readProjectIndex(storage) -> {status:'empty'|'ready'|'partial'|'unavailable',projects,errors}`、`readFormIndex(storage) -> {status:'empty'|'ready'|'partial'|'unavailable',forms,errors}`、`persistProjectIndex(storage, projects) -> {ok,error?}`、`isRelevantPortalStorageKey(key) -> boolean`。両read関数は書込を行わず、企画とフォームは独立したstatusで表示する。

- [x] テストを先に作る：旧キーのみ／Reactキーのみ／同じroomIdの両形式／旧historyの古い名称／不正JSONの1件／巨大数`1e20`の日時／保存領域の例外を入力し、重複なし・最新名称・Date例外なし・正しいstatusをassertする。
- [x] テストに、readProjectIndexを2回呼んでもsetItemが0回、同じprojectsを2回persistしても追加書込0回となるassertを入れる。
- [x] 壊れたフォーム履歴JSONがあっても正常な企画一覧が表示できること、フォームだけが読取失敗になることをassertする。正常な空配列はempty、不正なルートJSONはunavailable、配列の一部が不正ならpartialとする。
- [x] `node --test tests/portal-history.test.mjs`で未実装による失敗を確認する。
- [x] 上記interfaceを実装し、Appの読取・保存・storageリスナーを置換する。新キーのroomIdをdecodeし、読取対象の末尾`:room`を確認する。名称の優先順は更新日時、新形式、既存索引の順。閲覧日時は有効な最大値を使う。
- [x] 同じコマンドで全ケースのPASSを確認する。取得不可の画面に再読込と理由の表示があることをブラウザで確認する。
- [x] 対象ファイルの差分をレビューし、後続のコミット方針に沿って確定する。

### Task 2：企画ツールから閲覧履歴を書き出す（P1-1／別リポジトリ）

**Files:** circle側`apps/react/src/services/portal-history.js`と`apps/react/tests/portal-history.test.mjs`新規、`apps/react/src/runtime.js`変更。

**Interfaces:** `recordPortalVisit(storage, {roomId,name,updatedAt}, openedAt) -> {ok,error?}`、`updatePortalProject(storage, {roomId,name,updatedAt}) -> {ok,error?}`。後者は既存のlastOpenedAtを変更しない。キーは`sanpokai_portal_project_history_v1`、互換キーは`syawari_last_room_id`と`syawari_last_opened_at_<roomId>`。

- [x] 取得できた実装先のAGENTS.mdを読んで、上記対象の最新版とAPIを確認する。
- [x] 直接起動したroomの閲覧記録／名称変更後もlastOpenedAt保持／既存room保持／保存失敗でも企画画面が起動できる、というテストを先に書く。
- [x] circleの`apps/react`で`node --test tests/portal-history.test.mjs`を実行し、未実装による失敗を確認する。
- [x] runtimeのstartで閲覧を記録し、storeの既存subscribeで名称・更新日時だけを追随させる。disposeで購読を解除する。索引更新を閲覧し直した扱いにしない。
- [x] 同テストと`npm test`を通し、portal側のTask 1のfixture契約とキー・項目が一致していることを確認する。
- [x] Task 1のみ完了した時点で「最近開いた」の全経路が直ったと報告しない。Task 2込みで直接起動の導線を確認する。

### Task 3：フォーム履歴を統合し入口をそろえる（P1-2）

**Files:** `public/form-maker/history-utils.js`と`tests/form-history.test.mjs`新規、`public/form-maker/index.html`変更、circle側`apps/react/src/components/AppHeader.jsx`変更。

**Interfaces:** `mergeFormHistories(stored, incoming, limit=10) -> FormRecord[]`。FormRecordは既存のformId・planName・title・createdAt・updatedAt・responseUrl・editUrl・projectUrl・spreadsheetUrlを保持し、未知の互換項目も破棄しない。重複の優先日時は有効なupdatedAt、なければcreatedAt。表示順は有効なcreatedAt降順、不明日時は末尾、同時刻はformIdで安定化する。

- [x] 既存10件＋新規1件、重複formIdの更新、日時順と配列順の不一致、不正項目、同時刻、同一入力を繰り返す場合のテストを先に書く。
- [x] `node --test tests/form-history.test.mjs`で未実装による失敗を確認する。
- [x] 統合後に上限を適用し、history-readyとhistory-updateに同じ関数を使用する。HTMLのscriptをmoduleとして`./history-utils.js`をimportする。通信payloadのsource・channel・typeは現行契約を維持する。
- [x] circleの関連アプリURLを`https://mutoshiki.github.io/sanpokai-kikaku-portal/form-maker/`にする。
- [x] 同テストでPASSを確認し、既存フォーム1件が表示できることと、10件に新規1件を受信するfixtureで新規が残ることを確認する。

### Task 4：テーマ設定をキーボードで操作可能にする（P1-4）

**Files:** `src/ThemeToggle.jsx`、`src/styles.scss`、`tests/portal-focus-smoke.cjs`。

**Interfaces:** preferenceの`system|light|dark`、white/g100、既存保存キーを維持する。onChangeは選択だけを変更し、close操作だけがパネルを閉じる。

- [x] 現在のフォーカステストに、閉じた設定ボタン→Tabがツールへ移動する、開いて矢印キーで3選択を移動できる、Escapeで閉じて設定ボタンへ戻る、という失敗ケースを追加する。
- [x] `npm run build`後に`node tests/portal-focus-smoke.cjs`を実行し、追加した回帰の失敗を確認する。
- [x] 非表示パネルの内容をTab順から外し、閉鎖時のfocus復帰とaria-controlsを実装する。表示テーマという文言の重複も整理する。
- [x] 同テストとサイドブラウザの実操作でPASSを確認する。設定変更・閉鎖・復帰後に見えるフォーカスがあることを確認する。

### Task 5：履歴のリンクとフィードバックを整理する（P2-1）

**Files:** `src/App.jsx`、`src/styles.scss`、`tests/portal-browser-smoke.cjs`。

- [x] form名→responseUrl、別リンク「企画を開く」→projectUrl、最近の企画→room URLという期待結果を既存ブラウザ検査へ追加する。コピー失敗で成功通知が出ないこともassertする。
- [x] Carbonの非クリック行に通常リンクと独立したOverflowMenuを配置する。アイコンを第二の見せかけのボタンにせず、対応するリンクの装飾にする。
- [x] URLのあるリンクはhref・target・relを持ち、移動先と新しいタブを読み上げ名で伝える。コピー成功を5秒、失敗を操作近くの保持メッセージにする。
- [x] `npm run build`と`npm run test:browser`を通し、フォーム操作メニューで企画へ誤遷移しないことを確認する。

### Task 6：情報順・空表示・文字組みを改善する（P2-2／P2-3）

**Files:** `src/App.jsx`、`src/styles.scss`、`index.html`、`tests/portal-browser-smoke.cjs`。

- [x] 初回の空状態はツール先頭、有効履歴がある初回読込は企画→フォーム→ツールになるfixtureと、フォーカス中の追加ではDOM順が変わらないassertを追加する。
- [x] 上記仕様の順序・h2見出し・空表示・再読込案内を実装し、表の短い説明文、heading-compact-01／body-01、aria-describedbyを適用する。index.htmlの静的入口も同じツール名・説明・移動先にそろえる。
- [x] 余白と標準ブレークポイントをトークンへ整理する。独自CSS Gridの全面撤去を完了条件にしない。
- [x] 320／390／672／1056／1280px、200%拡大、ライト／ダークで、横スクロール・切れ・重なり・読みにくい長文がないことをブラウザで確認する。全幅の画像証拠を保存する。

### Task 7：フォーム入口の復旧状態を実装する（P2-4）

**Files:** `public/form-maker/index.html`、`tests/portal-history-origin-smoke.cjs`。

- [x] 初回の有効なhistory-ready到達、10秒の未到達、遅れて到達、直接開くリンクが表示・Tab操作できる場合を、テスト用iframeで先に検査する。
- [x] z-index:-1を廃止し、見える復旧リンク・遅延メッセージ・既存通知による到達確認を実装する。iframe loadだけを成功条件にしない。
- [x] テスト用iframeの遅延・失敗を検査し、直接URLへ移動できることを確認する。Google側の作成処理はこのfixture確認で代替したと明記する。
- [x] メール欄の説明、iframeテーマ受信API、通知元の条件は外部ソース取得後の別タスクとして扱う。未取得のAPIを本タスクに混ぜない。

### Task 8：実オリジンの履歴回帰と最終確認

**Files:** `tests/portal-history-origin-smoke.cjs`新規／拡張、`package.json`に`test:history`を追加、`README.md`更新。

**Interfaces:** `test:history`は`node --test tests/portal-history.test.mjs tests/form-history.test.mjs`。origin smokeはビルド済みdistをNodeの一時HTTPサーバーで配信し、同じcontextの2ページを実際に開く。既存のabout:blank＋mock localStorageの検査だけで完了にしない。

- [x] React形式だけの保存→ポータル表示、保存済み10フォーム＋新規1フォーム、2ポータルのイベント収束、1件の破損後も残る正常行、という実オリジンのfixtureを実装する。
- [x] 1回のroom変更に対する索引書込が1回以内であり、2タブから同じ内容を再読取しても新しい索引イベントが発生しないことをassertする。
- [x] `npm run test:history` → `npm run build` → `npm run test:browser` → `node tests/portal-history-origin-smoke.cjs` → `node tests/deployment-contract.cjs`を実行し、全PASSを確認する。失敗したチェックは原因と未完了範囲を報告する。
- [x] READMEにReact保存形式、索引契約、同一ブラウザ制約、正常な空表示と取得失敗の違いを記載する。
- [x] 公式ガイドと改修差分を再照合し、サイドブラウザに完成画面と証拠を提示する。Apps Script内部の作成・招待・回答連携を実データで確認していなければ、その範囲を明記する。

## 実装結果と残る範囲

- ポータル履歴の読取・統合、企画ツール側の閲覧記録、フォーム履歴の統合と入口、設定パネルのキーボード操作、リンク／コピー応答、情報順序とレイアウト、フォーム入口の復旧表示、同一オリジン回帰テスト、READMEを実装した。
- circle-kikaku-tools は最新ソースのコミット `e5e82800eef36e1bf85f0484aebcfcc25c83b1aa` を基準に、別の作業ツリー `circle-kikaku-tools-portal-history` の `codex/portal-history-bridge` で変更した。両リポジトリとも未コミット。
- Google Apps Script本体のソースとテーマ受信APIは利用できなかった。したがってiframe再読込時の入力保持、メール欄の用途、実際のフォーム作成・招待・回答連携は検証・変更対象外として残す。テスト用iframeによる入口の復旧動作は確認した。
- 実施テスト：ポータル履歴／フォーム履歴11件、ブラウザー画面・キーボード操作、実オリジン連携、Pages配信契約、企画ツール全102件、および両アプリのビルドがPASS。
- push・デプロイ・本番データ変更は行っていない。
## 参考画面

監査開始時の狭いトップページ：

![狭い幅のトップページ](C:/Users/としき/.codex/visualizations/2026/10/13/01a133d6-7571-75a2-a3af-68ec3b91cd7d/carbon-audit/01-portal-narrow.png)

テーマ設定パネル：

![テーマ設定パネル](C:/Users/としき/.codex/visualizations/2026/10/13/01a133d6-7571-75a2-a3af-68ec3b91cd7d/carbon-audit/02-theme-panel.png)

監査開始時の1280pxトップページ：

![デスクトップのトップページ](C:/Users/としき/.codex/visualizations/2026/10/13/01a133d6-7571-75a2-a3af-68ec3b91cd7d/carbon-audit/03-portal-desktop.png)

フォーム履歴1件が表示されたダークテーマ：

![ダークテーマとフォーム履歴](C:/Users/としき/.codex/visualizations/2026/10/13/01a133d6-7571-75a2-a3af-68ec3b91cd7d/carbon-audit/04-portal-dark.png)

フォームメーカーの入力画面：

![フォームメーカーの入力画面](C:/Users/としき/.codex/visualizations/2026/10/13/01a133d6-7571-75a2-a3af-68ec3b91cd7d/carbon-audit/05-form-maker-entry.png)
