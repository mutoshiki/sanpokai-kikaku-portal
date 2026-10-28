# フォームメーカー公開までの残作業 実行計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan sequentially. ユーザーの指示なく別エージェントへ委任しない。実装済みの部分を作り直さず、工程ごとの証拠を残す。

**Goal:** 既存フォームを保持し、無料枠内の運用を実証した新フォームメーカーを公開し、公開URLで一連の操作を確認する。

**Architecture:** ポータルのReact画面から所有者別RTDBジョブを作り、専用Apps Script workerがForms・Sheets・Driveを操作する。互換ルール→worker→サークル企画ツールの接続部分→ポータルの順に反映し、限定受入後に通常受付を開く。

**Tech Stack:** React / Carbon / Vite、Firebase Auth・Realtime Database、Apps Script、GitHub Actions・Pages、既存Emulator・Playwright検証。

**Spec:** [承認済み再設計案](../specs/2026-10-15-form-maker-foundation-redesign.md)、[元の実装計画](2026-10-15-form-maker-foundation-rebuild-plan.md)。本書は残作業の実行順と合格条件を補足する。

作成日: 2026-10-16 JST。今回は計画作成のみ。以下の未チェック工程は未実施。

## Global Constraints

- Apps Scriptはサイドブラウザの `sanpokai.formmaker@gmail.com`、FirebaseはChromeの `610unko@gmail.com`。既存タブを使い、`/u/1` だけでアカウントを判定しない。
- 専用worker Script IDは `1Z_fpG_nd4UazqRZKbZHhzlcTsD0jBEaUXIqCXmqNTmgg5edgLNljgx50`。旧A/Bは `1m39W74vR_dyz05yuL24tjym8hdjUxS9NoLev5qWnPsDcYqCh41LG7Sjl` の別デプロイ。新workerを旧A/Bへ送らない。
- Firebase projectは `sanpokai-tool`。有料サービス・プラン変更を追加しない。既存Blazeの無料枠内運用を条件とし、無条件の料金ゼロを保証しない。
- 実フォーム・回答・履歴・参加者・車割り・精算を保持する。通常データで障害試験をせず、合成企画と架空回答で検証する。
- 同じformの応募同期writerは一つ。旧依存がある限り旧A/Bと旧同期を保全し、全件移行を新規公開の前提にしない。
- dirtyな作業ツリーをpull/reset/stash/clean・一括commitしない。Cの中止済みCarbon全面改修を再開しない。
- 既承認の通常操作で都度止まらない。新しい権限・共有先・追加テスト資産や要求緩和が必要な場合だけ、具体的な差分をまとめて確認する。
- 公開保留中も読取り調査、ローカル修正、検証、復旧準備を続ける。Google内部原因の完全解明を全作業の再開条件にしない。

## 現在地と訂正すべき前提

| 対象 | 記録上の実装・検証 | 公開までの残件 |
|---|---|---|
| P: ポータル | 同一originの新画面・履歴・予約枠をローカル実装、ブラウザ検証済み | 本番テストの旧iframe前提を更新、公開 |
| F: worker | 合成フォーム→回答→Firebase→企画表示、限定CSV出力を確認済み | 最新保存ソース一致、負荷、ログ、期限処理、公開 |
| C: 企画ツール | 追加ルール・書類出力adapter・予約枠をローカル検証済み | 公開版へ必要差分だけ移植し、標準releaseで公開 |
| 受付 | 2026-10-16 05:52 JSTの記録では停止 | 実行時に再確認、限定受入後に通常受付へ |

1. 約511.02分/24h（旧同期約475.07分、新worker約34.56分、その他約1.39分）は以前の実行一覧集計。Google内部のquota残量そのものではない。重複・実行種別・実行者・計測窓を照合する。
2. 旧同期の直近失敗ログは汎用server errorとJavaScript engineのINTERNAL。quota超過やFirebase 401/403を原因と断定しない。`auto-sync:160:13` は保存済みソースへ対応づける。
3. Pの `tests/deployment-contract.cjs` は削除予定の `public/form-maker/index.html` を読み、`tests/production-pages-smoke.cjs` は旧iframe内のUIを待つ。新画面に合わせる残件がある。
4. 現在のC作業元には本番release workflowが欠け、GitHub mainには `react-production-release.yml` がある。2026-10-16に取得した公開manifestのsourceShaは `c234929b4b0c4adffadf1134893042087bb4c6c7`。実行時に公開SHA/digestを取り直す。
5. workerの現在の応募同期5分間隔と、元specの健康時3分以内目標は整合しない。cadence・負荷・実待ち時間を一緒に検証し、目標を黙って緩和しない。
6. 自動cleanupの確認基準はコード保存から24hではなく、対象CSVのledgerにある `expiresAt`。CSVは既に手動でゴミ箱へ移動済みであり、今回確認できるのは定期処理と台帳除去。
7. 元specの重複historyノード案・P/Cの匿名UID共有案は後続計画で置き換え済み。jobsを履歴の正本とし、別origin間は既存capabilityを検証する現在の契約を維持する。

## Review Focus

- 別アカウント・Script・古いworktreeへの更新を、本人表示・ID・hash・公開manifestで拒否する（Task 0、5）。
- 受付停止中も期限処理が動き、既存同期の失敗を0人で上書きしない（Task 1、4）。
- 限定受入中に通常利用者を受け付けず、2タブ・離脱予約・回復で二重作成や他UIDへの漏れを起こさない（Task 2、6、8）。
- 公開CIが旧iframeを待ち続けず、認証/履歴失敗が入力画面全体を塞がない（Task 3、7、8）。
- 期限処理・writer移行・切戻しが別ファイルや別企画へ作用しない（Task 4、9）。

## 対象ファイルと記録

| 記号 | 現在の絶対パス | 範囲 |
|---|---|---|
| P | `C:/Users/toshi/Documents/GitHub/sanpokai-kikaku-portal` | UI、services、公開契約/本番smoke、Pages workflow |
| F | `C:/Users/toshi/.codex/worktrees/form-maker-carbon-ux/sanpokai-form-builder` | worker、`auto-sync.js`、tools、tests、release文書 |
| C | `C:/Users/toshi/Documents/GitHub/circle-kikaku-tools` | 候補参照元。ルールとadapterの必要差分のみ |
| C-release | Task 0で確定する公開基準checkout | 現行C全体を公開せず、必要差分を現行公開版へ移植 |

Create: P `docs/releases/2026-10-16-form-maker-release-execution.md`（実行時）。各工程の時刻・対象・結果・残件を記録する。token、資格情報、回答全文、学籍番号、メール本文を記録しない。完全ソース・rules・移行inventory等の保全物はrepo外へ保存し、記録には所在とhashだけ残す。

## 実行順と判定

1. Task 0で対象と復旧元を固定し、Task 1の診断・必要な旧同期保守を進める。
2. Task 2の限定受付をローカル実装する。Task 4の事前ログ検査とTask 5のbackend用テスト・backup・dry-runを通し、限定保守として専用backendへ反映する。この段階のG1未合格は、一般公開を禁止する条件であり、負荷測定に必要な限定保守まで禁止する条件ではない。
3. Task 1の限定試験でcadence・件数を選ぶ。選んだ最終backendコードを同じ保守手順で反映し、test modeで通常利用者を拒否したまま連続24h測定を開始する。測定中はTask 3、Task 4の期限確認、Task 5のクライアント公開準備を進める。
4. G1/G2合格後にTask 5の最終manifestを固定し、`Task 6 → 7 → 8`。Task 6では既に同一hashのbackendを不要に再反映しない。Task 9は公開後の旧フォーム移行。

測定後にbackendのコード・cadence・同期対象数を変える場合だけ、影響を確認して24h測定の取り直しを判断する。文書やクライアントだけの変更で背景負荷測定を機械的に最初からやり直さない。

| ゲート | 合格条件 | 不合格でも続ける作業 |
|---|---|---|
| G0 対象 | 正しい実行者・Script・C公開基準・完全な復旧元 | ソース照合、ローカル検証 |
| G1 負荷・応答 | Task 1の24h測定、運用予算、待ち時間に合格 | 狭い保守修正、Task 2〜5の準備 |
| G2 情報・期限 | Task 4のログ確認・期限処理・Blaze監視方針が確定 | ローカル修正と非書込み検証 |
| G3 公開物 | Task 5の最終hash・対象・復旧対が一致 | 差分レビューと候補更新 |
| G4 公開後 | Task 8を公開URLで完走 | 受付停止、該当層の復旧と修正 |

### Task 0: 公開基準とバックアップを固定する

**Files:** P実行記録、F `deployment/form-maker-targets.json`、`docs/releases/form-maker-foundation-release-runbook.md`。適用AGENTSとworktree一覧を再確認する。

**Produces:** P/F/CのHEAD、C公開SHA/digest、C-releaseパス、worker保存hash、rules保存hash、実行者、trigger設定、intake状態、確認時刻をまとめたbaseline。

- [ ] P/F/Cのbranch・dirty差分・未追跡を保全し、公開対象候補をファイル単位で列挙する。
- [ ] サイドブラウザで専用workerと旧同期のID・本人表示・保存ファイルを照合し、正規の読取り手段で完全な復旧元を保存する。backup前にtriggerを削除しない。
- [ ] 現在の権限で正規API/claspを使えるなら実行主体を確認して使用する。通常編集UIも使える。過去に拒否された転送経路を迂回せず、完全ソースを取得できなければG0未完了として他の準備を進める。
- [ ] Cの公開manifestとmainのrelease手順を読み直し、適切な既存checkoutを再利用する。なければ公開SHAからmanaged worktreeを用意する。dirtyなCにpullしない。
- [ ] Cの `firebase/database.rules.json`、`apps/react/src/services/handoff-export.js`、`apps/react/src/sync/firebase-transport.js`、`apps/react/src/components/ProjectTools.jsx` と対応テストの差分を選別する。公開版の新しい保護機能やworkflowを古いRCで戻さない。

**Pass:** 正しい更新先と復旧元をhashで指定でき、現在の受付停止を確認できる。

### Task 1: 集計を精査し、無料で続く負荷と待ち時間へ収める

**Files:** Create F `tools/form-maker-runtime-report.mjs`、`tests/form-maker-runtime-report.test.mjs`。必要時のみF `auto-sync.js`、`worker/{trigger,managed-sync}.gs` と対応テスト、`docs/releases/form-maker-free-feasibility.md`。

**Interface:** `summarizeRuntime(rows, {start, end, ownerKey, quotaMinutes, budgetMinutes})`。rowsは任意のexecutionId、scriptId、handler、executionType、ISO startedAt、durationMs、status、匿名化ownerKey。窓は `[start, end)` とする。集計件数、triggerMinutes、種別/handler別集計、重複件数、拒否行、前提を返す。CLIは `node tools/form-maker-runtime-report.mjs <repo外input.json>` とし、inputにrows/optionsを含める。欠測・集計不能行があれば合格を返さない。外部通信・書込み0件。

- [ ] 重複ID、窓境界、タイムゾーン、失敗実行、web/manual混在、実行者不一致、非数/負durationのテストを先に作る。失敗実行の時間も勝手に除外しない。
- [ ] ID不明行はscript/handler/種別/開始時刻の複合キーで重複候補を検出し、曖昧な衝突は統合せず拒否する。テストを失敗→修正後成功で確認する。
- [ ] 約511分の集計を再現し、triggerとその他、全ページの取得範囲・欠落・実行者を照合する。UI経過時間合計をGoogle内部quotaカウンターそのものと扱わない。
- [ ] 旧同期の失敗位置を保存ソースへ対応づけ、処理時間の内訳を確認する。利用中フォームの回答全文やメール等を診断ログに追加しない。
- [ ] 不要な再読取り・同一回答の再処理・無制限再試行を先に減らす。単純な同期間隔延長で既存動作を悪化させず、読取り失敗時のsnapshot保持と回答編集/削除検出をテストする。
- [ ] 旧同期の必要な修正は旧保存版への最小patchとしてテストし、個別backup後に限定保守反映する。F候補全体を旧A/Bへpushしない。負荷解消のための保守を、G1未合格の新経路公開と混同しない。
- [ ] 応募同期5分間隔のまま3分目標を合格にしない。軽量化と1分間隔等の候補を比較し、負荷内で180秒以内を実測できるcadenceを選ぶ。両立不能なら具体的な仕様差分を提示し、勝手に目標を緩和しない。
- [ ] 設定を固定し、同一実行者の全Scriptを含む連続24hを測る。Googleの「最初の要求から24h」というquota周期と測定窓を区別し、可能ならずらした窓も比較する。
- [ ] Task 2のテスト所有者制限を有効にして、専用合成jobで要求→開始→完了、回答→同期→企画表示を計測する。通常利用者の受付は開かない。Task 2の反映前はローカル検証と背景負荷測定まで進める。

**Pass:** 適用quotaが不明ならconsumerの90分/日を保守的に使う。今回の運用予算案は全体60分/日以内であり公式値ではない。24h観測値と追加job込みの予測が予算内にあること。追加jobは観測最大処理時間の2倍を計画値とし、再試行とフォーム増加による定期走査増分も含める。現在の40件/日は無条件に維持せず、収まる件数へ下げ、worker/status/UIを一致させる。40予約枠は同時未処理上限であり課金上限ではない。

待ち時間の初回受入基準案は作成開始120秒以内・完了300秒以内。応募同期は元specどおり健康時180秒以内。空キュー時と同期重複時を分け、単発値をp95や製品保証とは呼ばない。無料で両立しない場合は受付停止を維持し、無料案の構成/対象範囲を見直す。有料化や別アカウントへの自動逃避はしない。

### Task 2: 通常利用者を巻き込まない限定受入を用意する

**Files:** C-release `firebase/database.rules.json`、`tests/form-maker-admission-rules.mjs`、adapter tests。P `src/services/form-maker-session.js` と対応テスト。F `worker/{queue,handoff,trigger}.gs` と対応テスト。

**Contract（追加案）:** `formMakerV1/status/acceptanceMode` は `test | open`、未設定は互換のためopen扱い。ただし既存の `accepting:false` を常に優先する。worker側の正本はScript Property `FORM_MAKER_ACCEPTANCE_MODE_V1` とし、statusの初期化/定期更新でもmodeを消さず毎回反映する。`formMakerV1/testOwners/{uid}=true` はworker/管理者だけが設定でき、clientは自分のentryのみ読める。test時は許可UIDだけがslot予約・作成job・handoff jobを作成/処理できる。P/Cの匿名UIDは別なのでそれぞれ指定する。

- [ ] Emulatorで「pausedは全員拒否」「test時は登録UIDだけ許可」「clientの自己登録・他UID読取り・全体列挙を拒否」「open時は既存契約維持」を検証する。
- [ ] workerでもtest時に未登録ownerをclaimしないこと、status heartbeat/再起動でmodeがopenへ戻らないことを確認する。mode不正値やtest owner判定の読取り失敗は許可扱いにせず、job/資産を保持して停止する。
- [ ] 非対象端末には作成を許可せず「メンテナンス中」と表示する。履歴や画面全体を読み込み待ちで塞がない。既存フォームの同期・期限処理はこの受付制御で止めない。
- [ ] 最新契約をEmulator/worker/P/C adapterで確認し、Task 4/5の検証とbackup後、追加rules→専用workerの順で限定試験に必要な部分だけを反映する。受付はtest modeと登録したテストUIDに限定する。
- [ ] 限定試験用のbackend保守反映と一般公開を分ける。G1/G2未合格時に通常受付やクライアント全面公開をしない。

**Pass:** 公開後の受入でも許可したテスト端末だけが操作でき、全体受付を一時開放する必要がない。これは未実装の追加作業であり、既存40枠だけで実現済みと扱わない。

### Task 3: 新画面を判定できる公開テストへ揃える

**Files:** P `tests/deployment-contract.cjs`、`tests/production-pages-smoke.cjs`、`.github/workflows/deploy-pages.yml`、必要時 `tests/form-maker-browser-smoke.cjs`。Fのmanifest対象にも公開テスト/workflowを追加する。

- [x] 削除予定の旧hostファイルと `#form-maker-frame` を必須にする現行assertionについて、現在の候補に対する失敗を確認する。
- [x] deployment-contractを `form-maker/index.html`、`dist/form-maker/index.html`、Pages base、built asset参照の検査へ更新する。既存のポータル静的fallback検査は保持する。
- [x] 本番smokeを新しい入力欄・主操作・テーマ保持・黒いヘッダー・390/1280px overflowの検査へ変更する。Google wrapperやiframeを待たない。本番自動smokeは作成/回答送信を行わない。
- [x] 認証/履歴エラー時の局所表示、2タブ・離脱予約・保存領域拒否の既存検証を確認し、不足分だけ追加する。破壊的な権限/枠競合はEmulatorで行う。
- [x] workflowの古い「embedded host」説明も更新する。Pで `npm.cmd run build` → `node tests/deployment-contract.cjs` → `npm.cmd run test:history` → `npm.cmd run test:browser` を通す。
- [x] 更新した本番smokeを `LIVE_URL` でローカル候補配信先にも向ける。ローカル候補の確認済み: `http://127.0.0.1:4182/sanpokai-kikaku-portal/` でstatus 200、390/1280px横overflowなし、same-origin form-maker（iframe 0）、テーマ/黒いheader、画面errorなし、Firebase writes 0。
- [ ] 更新smokeを公開後の公開URLにも向ける。公開前のため未実施。

**Pass:** 新画面を公開してもCIが旧iframe待ちにならず、履歴待ちによる画面閉塞を検出できる。

### Task 4: ログ・期限処理・Firebase監視を確認する

**Files:** F `worker/{handoff,trigger}.gs`、`worker/tests/{privacy-logging,handoff,trigger}.test.cjs`、feasibility、P実行記録。不一致がある箇所だけ修正する。

- [ ] 専用workerと旧同期のCloud Loggingについてproject・log名・閲覧可能期間を特定し、合成受入開始の2026-10-15から現在までを最低範囲として確認する。利用可能な旧ログの範囲も記録する。
- [ ] 成功・共有失敗・認証失敗・一般例外で、学籍番号/回答全文/token/メール混入の有無を確認する。記録は検索条件と件数・有無だけにし、機微値を転載しない。未閲覧範囲を「PIIなし」と判定しない。
- [ ] 混入があれば該当ログの回帰テストを失敗→修正後成功で確認する。過去ログの永久削除や追加権限付与は勝手に行わない。
- [ ] 承認済みCSVのledgerの `expiresAt` と保存済みhandlerを照合する。作成記録は2026-10-15 19:35 JSTだが、正確な期限はledgerを使う。
- [ ] 受付pausedでも期限後の定期cleanupが対象entryだけを除去することを、前後のledgerとcleanup時刻で確認する。現行候補の1時間throttleとtrigger間隔を考慮し、24hちょうどの削除とは表現しない。
- [ ] CSVは既にゴミ箱にあるため、実ファイルの自動移動まで証明したと書かない。復元・追加出力・ゴミ箱を空にする操作を混ぜない。
- [ ] ChromeでBlazeの最新使用量・請求額と既存budget alertを確認し、監視担当・確認頻度・停止基準を固定する。通知は支払上限ではなく、受付停止でも既存DB通信は続くと記録する。

**Pass:** 対象/期間/限界を明記したログ確認、現在の候補の機微ログ除去、期限処理、監視方針を確認できる。未確認を合格へ丸めない。

### Task 5: 最終候補と復旧対を固定する

**Files:** F `tools/foundation-release-manifest.mjs`、`tools/apps-script-release-dry-run.cjs`、targets、release runbook。P/F/C-releaseの対象差分のみcommitする。

- [ ] Fで `npm.cmd run test:worker`、`test:recovery`、`test:migration`、`test:release-dry-run`、`node tests/apps-script-deployment-target-contract.cjs`。cadence/日次上限/限定受付を変えた境界テストも通す。
- [ ] C-releaseで既存rules全体、予約枠、adapterを検証する。現在候補のscript名は `test:firebase:emulator`、`test:firebase:form-maker-admission`、`test:form-maker-admission-adapter`。React unit/buildと公開版のreadiness条件も維持する。
- [ ] PはTask 3を通す。以後の再実行は変更・失敗・新たな懸念の影響範囲と標準release必須項目に限る。
- [ ] runbookの重複番号、cleanup未保存という古い現在状態、固定cadenceを最新証拠で更新する。過去観測は日付付きで保持する。
- [ ] 実際のC-releaseを指定してcross-repo manifestを生成する。生成でlive欄が初期化されるので、その後に本人/trigger/paused/保存hash/公開rulesを再確認して追記し、最後に `--check` を通す。
- [ ] candidateは `Code.gs`、`appsscript.json`、`release-manifest.json`、`targets.json` の4ファイル。pushは最初の2ファイルだけ。backupは24h以内の完全な2ファイルと `backup-manifest.json` をrepo外に別置きする。
- [ ] `node tools/apps-script-release-dry-run.cjs <candidate-directory> <rollback-directory>` が `status: ready` / 外部書込み0件になることを確認する。正規CLIの実push一覧も2ファイルであることを照合する。

**Pass:** 最終候補・復旧対の対象/hashが一致する。Task 2の限定保守時も必要なbackend部分について同じbackup/dry-run手順を使う。新経路の一般公開にはG0/G1/G2/G3をすべて要求する。

### Task 6: 受付制限を維持してルール・workerを反映する

- [ ] 直前に保存ソース/rules/intakeにdriftがないか確認し、変化があれば差分を照合して候補を再固定する。
- [ ] 既存roomの意味を変えない追加ルールを先に公開し、公開hashを照合する。限定保守で同一hashが反映済みなら再公開しない。
- [ ] 専用workerの実行完了を待ち、専用の2triggerだけ一時停止する。旧プロジェクトのtriggerを止めない。
- [ ] 正しい専用Scriptへ2ファイルだけを保存/pushし、読取り直した保存版hashを照合する。定期workerなのでWebデプロイを新設・更新しない。同一hashが保存済みなら置換を省略する。
- [ ] worker healthと空キュー確認後、Task 1で合格したcadenceで `runFormMakerQueueV1` / `runFormMakerApplicationSyncV1` を同じ所有者で復旧する。
- [ ] paused時の予約拒否・受付済みjob保持・定期成功と、test modeでの登録UID限定動作を確認する。枠は専用テストjobで確認し、試験後に残さない。

**Pass:** rules/保存ソース/trigger/限定受付が一致。失敗時は受付停止を維持して検証済みソースへ復旧し、job・履歴・資産を消さない。

### Task 7: Cの接続部分とポータルを標準releaseで公開する

- [ ] C-releaseの必要差分をmainへ統合し、同じmain SHAの `Release / Readiness` 成功後に `React Production Release` を使う。古いRCの `deploy-react-pages.yml` で代用しない。
- [ ] C公開 `release-build.json` のSHA/digestと対象routeを照合し、標準releaseの検証room `P9A93LMQ` のcleanup完了も確認する。通常roomを代用しない。
- [ ] P対象差分を統合し、Quality guard成功後に `Deploy Pages` でdistを公開する。Task 3で更新した `pages-production-smoke` の成功を確認する。
- [ ] 公開直リンク・再読込み・戻る操作で同一originの新画面を確認する。旧iframeならキャッシュ/成果物を調べ、別buildの成功で代用しない。

**Pass:** 公開P/CのSHAと成果物が確認でき、Googleログイン状態によらず新画面が描画される。通常受付はまだ開かない。

### Task 8: 公開URLで限定受入し、通常受付へ切り替える

**Test data:** 既承認の架空企画 `P1C34AE0E8277438BBAE` と合成回答を再利用。新規作成は専用テスト用途の1job、再送/2タブは同じjob。test modeでP/CそれぞれのテストUIDだけ許可する。CSV共有先は登録済みの `610unko@gmail.com` のみ、検証後は承認どおりゴミ箱へ移す。

- [ ] 現在の複数Googleログイン済みサイドブラウザで一覧→入力→作成受付→完了→結果リンク→履歴を操作する。認証・入力・履歴を別々に確認する。
- [ ] 2タブ/再読込みでフォームが増えず、通信中断後は既存job照会へ戻ることを確認する。公開資格情報を壊す試験はしない。
- [ ] 架空回答→許可項目だけのapplicationSync v2→同じ企画の応募者表示を照合する。合成回答の編集/削除でもsnapshotが更新され、確定済み参加者/車割り/精算が書き換わらないことを確認する。
- [ ] 公開Cから書類出力を操作し、CSV内容・編集者のみACL・Googleログイン下の取得を確認する。作成/出力/履歴を別々の証拠にする。
- [ ] 「企画を開く」は別タブで一度だけ開き、元のフォームメーカーが遷移しないことを確認する。
- [ ] 390/1280px、ライト/ダーク、黒いヘッダー、横overflow、必須入力、コピー成功/失敗、キーボード/フォーカスを確認する。局所障害の再現はローカル隔離試験で補う。
- [ ] Safari/VoiceOver実機を利用できれば確認し、できなければ未検証と明記する。WebKit/Chromium成功を実機合格に置き換えない。最終記録に検証範囲の限界を残す。
- [ ] Task 1の待ち時間、実行時間/使用量増分、枠解放、残存資産・ゴミ箱移動を記録する。全件合格後に測定済み日次上限でopenへ切替え、不要なtestOwnersを除去し、status/UIの一致を確認する。

**Pass:** 公開URLの表示・作成・共有・履歴・回答・同期・企画表示・書類出力が個別合格。失敗時は受付停止、該当層を復旧し、失敗経路と影響範囲を再確認する。

### Task 9: 旧フォームを公開後に一件ずつ移す

**Files:** F `tools/form-migration-dry-run.mjs`、`auto-sync.js`、`worker/managed-sync.gs`、`worker/tests/migration.test.cjs`、非公開移行台帳。

- [ ] repo外metadata inventoryを `node tools/form-migration-dry-run.mjs <inventory.json>` で検証し、`ready` / `externalWrites:0` を確認する。履歴だけで所有権を作らない。
- [ ] 最初は合成フォーム1件。旧form単位pause→lease終了→同じIDを新workerへ登録→同期/書類出力を確認する。旧側adapter導入も保存版への最小patchと個別backupを使う。
- [ ] 1件ごとにwriter一つとID/回答/企画/参加者保持を照合してから次へ進む。未移行formの旧writerは保つ。
- [ ] 切戻しは同じformの新writerをpause確認してから旧writerを再開する。停止確認が曖昧なら自動再開しない。
- [ ] 旧依存がゼロになった場合だけ旧trigger停止・A/B保管を実施する。フォーム/回答の永久削除は含めない。

**Pass:** 移行対象ごとにwriterは一つで資産を保持する。新規公開の完了と旧全件移行の完了を分けて報告する。

## 切戻し

| 失敗箇所 | 即時対応・復旧 |
|---|---|
| rules/hash/worker health | 受付停止、worker実行を排出。検証済み復旧ソースへ戻しhash照合。参照元がある追加rulesは削除しない |
| C公開・書類出力 | 受付停止、標準releaseの検証済みartifactへrollback。新workerを旧A出力へ誤接続しない |
| P公開・route | 受付停止、検証済みP artifactまたは説明付き停止画面へ戻す。壊れた旧iframeを自動復旧先にしない |
| 同期不整合・二重writer | 対象formの新writerをpauseし、そのformだけ旧writerへ戻す。room全体をbackupで上書きしない |
| quota/利用量悪化 | 新規受付停止、監視継続。既存同期を全停止せず原因処理を縮小。料金停止を保証したと書かない |

## 完了報告と所要時間

- 公開URL、P/C公開SHA/digest、worker保存hash、rules hash、実cadence/上限、G0〜G4、公開操作の結果を報告する。
- 残存テスト資産・ゴミ箱移動・未実施の実機検証・旧移行残数を記録する。HTTP 200、ローカルbuild、CIだけで完了にしない。
- 最短でも最終的な負荷変更後に連続24hの観測が必要。TTLはledgerの期限とcleanup実行時刻を使う。観測中にTask 2〜5を進め、時間待ちしか残らない場合は次に確認する時刻と項目を具体的に記録する。測定をやり直すのは条件変更・欠測・異常で必要になった場合だけ。

## 公式仕様と今回の判断（2026-10-16確認）

| 公式資料 | 採用判断 |
|---|---|
| [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas): ユーザー単位、最初の要求から24hでリセット、consumer trigger runtimeは90分/日 | 帰属と測定窓を照合。60分運用予算・最大処理時間2倍・作成120/300秒は今回の初回運用基準案であり公式値ではない |
| [Installable triggers](https://developers.google.com/apps-script/guides/triggers/installable): 作成者として実行され、起動時刻は厳密な保証ではない | Script分割でquotaは増えない。間隔だけで応答合格にしない |
| [RTDB billing](https://firebase.google.com/docs/database/usage/billing): Blazeは無料枠超過で請求。budget通知は料金を上限で止めない | 枠・日次上限・監視を併用し、無料保証やalertによる課金封じと表現しない |
| [clasp README](https://github.com/google/clasp#push): pushはオンラインproject全内容を置換 | 完全backup、専用ID、push2ファイル、保存hash照合を必須にする |

## 自己レビュー

- [x] 元計画Task 2・6〜9の残件を工程へ割り当てた。
- [x] 旧公開テスト、Cの古い作業元、5分/3分の不一致を扱った。
- [x] 限定試験のために一般受付を開かない契約を明記した。
- [x] 負荷保守と一般公開を区別し、観測中の作業継続を明記した。
- [x] TTLの基準、証明できる範囲、公式仕様と運用基準、公開と旧移行を区別した。
