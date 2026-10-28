# フォームメーカー残作業の完了・本番公開 実行計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan sequentially. 委任せず、既存の作業用checkoutとPRを引き継ぐ。チェックは実行した証拠がそろった時点で付ける。本書の作成だけでは公開操作を実施しない。

**Goal:** 認証情報の露出対応を済ませ、既存の測定結果と実装を使って新フォームメーカーを公開し、公開URLの実操作で完了を判定する。

**Architecture:** 同一originのReact画面→RTDBの所有者別job→専用Apps Script workerを維持する。新規回答はFormsイベント、取りこぼし等の照合は毎時処理を使う。追加の有料サービスを導入せず、約5人・週1回程度の利用に合う運用に収める。

**Tech Stack:** React / Carbon / Vite、Firebase Auth・RTDB、Apps Script、GitHub Actions / Pages、既存Emulator・ブラウザテスト。

**Spec:** [承認済み再設計案](../specs/2026-10-15-form-maker-foundation-redesign.md)、[元の実装計画](2026-10-15-form-maker-foundation-rebuild-plan.md)、[前回の残作業計画](2026-10-16-form-maker-release-execution-plan.md)。実行順と現在地は本書を優先する。機能契約は既存specを継承し、後続で採用したイベント同期・毎時照合と区別して読む。

作成日: 2026-10-19 JST。今回は計画のみ。GitHubの状態は今回再確認したが、Apps Script・Firebaseのlive状態は10月18日の記録であり、当日確認済みとは扱わない。

## 現在地

| 対象 | 今回確認した状態 | 引き継ぐもの |
|---|---|---|
| F: form-builder | PR #28、`a6671af`、OPEN / CLEAN、contract成功 | worker・同期・復旧・公開候補生成 |
| P: portal | PR #19、`9eff002`、OPEN / CLEAN、build-and-browser成功 | 同一origin画面・履歴・公開smoke |
| C: circle | PR #111、`97180c4`、OPEN / CLEAN、12チェックすべて成功 | 追加Rules・書類出力adapter・標準release |
| 専用worker | 10/18 09:55:17 JSTに保存ソースの2ファイルをpushし、readback一致を記録 | 今回の修正がなければ同じ内容を再pushしない |
| 24時間観測 | 指定窓は **10/18 09:55:17以上〜10/19 09:55:17未満 JST**。期間は終了済み、全件集計は未実施 | まず取得済み期間を集計する。最初から24時間待ち直さない |
| 受付・Rules | 前回は受付停止、40予約枠等の追加Rulesは未公開 | 実行時に再確認する |
| 認証情報 | 前回、設定画面のツール出力にworker用更新トークンが表示された | 外部不正利用は未確認。失効・更新済みという証拠もない |
| 合成CSV | 既に手動でDriveのゴミ箱へ移動済み | 復元しない。実ファイルの自動移動を証明済みにしない |

PR: [F #28](https://github.com/mutoshiki/sanpokai-form-builder/pull/28)、[P #19](https://github.com/mutoshiki/sanpokai-kikaku-portal/pull/19)、[C #111](https://github.com/mutoshiki/circle-kikaku-tools/pull/111)。merge直前にheadとCIを再確認する。

## Global Constraints

- Apps Scriptはサイドブラウザの `sanpokai.formmaker@gmail.com`、FirebaseはChromeの `610unko@gmail.com`。URLの `/u/1` だけで本人判定しない。
- 専用Script IDは `1Z_fpG_nd4UazqRZKbZHhzlcTsD0jBEaUXIqCXmqNTmgg5edgLNljgx50`、Firebase projectは `sanpokai-tool`。旧A/Bへ新workerをpushしない。
- Apps Script設定ページの全体取得、全Script Propertiesの列挙、認証値を含む画面撮影を行わない。秘密値をチャット・ログ・Git・コマンド引数へ出さない。
- 実フォーム・回答・job・履歴・参加者・車割り・精算を保持する。中止済みCのCarbon全面改修は混ぜない。
- dirtyな主checkoutをpull/reset/stash/clean・一括commitしない。Pの未コミット `public/form-maker/index.html` 削除、Fの `browser-evidence/` と候補manifest、Cの `apps/react/dist-offline-test/` を勝手に整理しない。
- 同じformの同期writerは一つ。旧フォーム全件移行は新規公開の前提にしない。
- 確認・通常の修正・既承認の操作は続行する。本人の認証操作、新しい権限付与、対象を増やすテスト、合格条件の変更だけを具体的に確認する。
- CI成功・HTTP 200・ローカル合格だけで公開完了にしない。公開後の実ブラウザ操作まで行う。

## 作業場所と記録

| 記号 | 絶対パス |
|---|---|
| P | `C:/Users/toshi/.codex/worktrees/form-maker-release-main/sanpokai-kikaku-portal` |
| F | `C:/Users/toshi/.codex/worktrees/form-maker-carbon-ux/sanpokai-form-builder` |
| C | `C:/Users/toshi/.codex/worktrees/form-maker-foundation-current-main/circle-kikaku-tools` |
| 本計画 | `C:/Users/toshi/Documents/GitHub/sanpokai-kikaku-portal/docs/superpowers/plans/2026-10-19-form-maker-release-completion-plan.md` |

実行時にPの `docs/releases/2026-10-19-form-maker-release-completion.md` を作り、工程・対象SHA/hash・時刻・合否・残件を追記する。ソースbackup・実行一覧の原本はrepo外に保存し、秘密値を含むproperties backupを共有artifactへ入れない。

## 実行順

**対象確認 → 認証修復 → 負荷判定 → 期限処理・ログ確認 → 公開候補固定 → Rules/backend → C → P → 限定受入 → 通常受付。**

負荷一覧の取得やローカル確認は認証修復の準備中も進められる。一般公開は認証修復・負荷判定・期限処理の合格後に行う。待ちが発生したら、必要な事象・次の確認時刻・その間に進める工程を記録する。

Task 1/3の手動専用helperと、Task 2で必要と判明した修正は、できる限りローカルでまとめて検証してから一度の保守反映にする。旧UIDの権限取消・失効は、その準備待ちを理由に先延ばししない。限定保守にもTask 4と同じ対象検査・fresh backup・dry-runを適用し、一般公開の合格前に通常受付を開かない。

## Review Focus

1. 認証修復で同じ漏出tokenを残したり、旧workerの権限を復活させない（Task 1）。
2. 測定期間終了と実測合格を混同せず、停止中の負荷だけで通常受付時を保証しない（Task 2）。
3. 空のCSV台帳・成功runだけから、自動期限処理が動いたと判定しない（Task 3）。
4. mergeでPagesが公開される順序を誤らず、PRと異なるSHAを合格扱いにしない（Task 4〜6）。
5. 新規回答のイベント、回答編集・削除の照合、履歴、別タブ遷移をそれぞれ確認する（Task 7）。

### Task 0: 対象と復旧元を確定する

**Files:** Pの実行記録、F `deployment/form-maker-targets.json`、既存release runbook。
**Produces:** P/F/CのHEAD、公開CのSHA/digest、保存worker hash、現行Rules hash、受付状態、trigger所有者と実間隔。

- [ ] 各checkoutのAGENTS・branch・dirty状態を再確認し、上表とPR headを照合する。差分の保全を優先する。
- [ ] 受付停止と実行主体を安全な表示で確認する。前回のtrigger設定はqueue毎分、専用照合毎時、旧同期毎時。設定propertyを実際のtrigger間隔の証拠にしない。
- [ ] 正規のclasp/APIで保存ソース2ファイルだけをrepo外へ取得しhashを計算する。資格情報ファイルや全propertiesを出力しない。Rulesのexact backupも別に取得する。
- [ ] Cの公開 `release-build.json` と標準 `React Production Release` を読み、旧版を復旧元としてSHA/digestで固定する。

**Pass:** 更新対象と復旧元が特定でき、受付は停止したまま。観測だけで本番設定を変えない。

### Task 1: 露出したworker認証を修復する

**Files:** 必要な最小追加はF `worker/provision.gs`、`worker/health.gs`、`worker/tests/worker-auth.test.cjs`。認可の回帰確認はC `tests/form-maker-admission-rules.mjs`。
**Consumes:** 正しい専用Scriptとworker UID、既存Firebase管理権限。**Produces:** 旧UID無効化・権限取消の記録と、新UIDでの最小権限接続。

- [ ] Firebase管理の正規経路で旧UIDの `formMakerV1/workers/{uid}` 権限を取り消し、旧Authユーザーの無効化とrefresh token失効を行う。利用者のAuth UIDやroomデータを削除しない。追加の管理アカウント・サービスアカウントを作らない。
- [ ] 既存 `setupFormMakerWorkerIdentity()` は設定済みなら既存UIDを返すため、再実行だけを更新完了にしない。匿名workerはtokenを失効させるだけでは再認証できないので、新しい専用UIDを用意する。
- [ ] 新しい秘密値を手でコピーしなくて済むよう、サーバー内で新UID/tokenを発行・保存する `rotateFormMakerWorkerIdentityV1()` を必要最小限で追加する。専用Script以外・queue稼働中は拒否し、Lock取得後に処理する。出力は `{ok:boolean, oldUid:string, newUid:string, state:string}` のみ。拒否時のUIDは空文字、stateは `wrong_script / queue_enabled / busy / provision_failed / save_failed` のいずれか。例外・ログにもtokenやHTTP本文を出さず、失敗後はpausedを維持する。認証キャッシュを追加した場合は更新時に必ず無効化する。
- [ ] `rotation_refuses_wrong_script_and_active_queue` と `rotation_never_emits_credentials_on_success_or_failure` を既存テストharnessで先に追加する。前者は `ok:false` と対応state、発行呼出し0回をassertする。後者は発行/保存失敗も含め、戻り値・捕捉ログ・例外を連結した文字列にfixtureの秘密値が含まれないことをassertする。未実装での失敗を確認してから実装し、成功まで確認する。新UIDは管理者が許可するまでDB権限を持たせない。
- [ ] 完全ソースbackupとcandidateを用意し、`apps-script-release-dry-run.cjs` の `status:ready` を確認してから専用triggerの実行を排出し、必要なら2ファイルを保守反映する。新UIDへのworker権限付与は具体的な対象・差分を提示して実行時点で確認する。保存ソースと許可UIDを照合し、安全なhealthとworker専用pathの読取りを確認してtriggerを復旧する。
- [ ] 旧UIDを許可一覧へ戻さず、失効したtokenを切戻し先にも使わない。失効だけでは既存ID tokenの即時無効化と同義ではないため、権限取消・失効時刻・有効期間を区別して記録する。露出したtokenを再表示・再使用して拒否試験しない。

**Verify:** F `npm.cmd run test:worker`、C `npm.cmd run test:firebase:form-maker-admission`。管理操作の結果はUID・時刻・成功/失敗だけ記録。
**Pass:** 旧worker権限がなく、旧refresh tokenが失効し、新UIDだけで必要な接続ができる。更新値は画面や会話へ露出していない。

本人操作を最初から前提にしない。既存の正規APIとサーバー内発行で進める。再ログイン/MFA、またはブラウザーで認証情報の入力・変更が必要な場合だけ、その操作を本人へ引き継ぐ。

### Task 2: 終了した24時間窓を集計し、負荷と待ち時間を決める

**Files:** F `tools/form-maker-runtime-report.mjs`、`tests/form-maker-runtime-report.test.mjs`、`docs/releases/form-maker-free-feasibility.md`。必要時のみ `worker/{firebase-client,queue,trigger}.gs` と対応テスト。
**Consumes:** Task 0の構成、全Scriptの実行一覧。**Produces:** 集計原本の所在/hash、採用するcadence・日次上限・待ち時間、合否。

- [ ] Apps Scriptの同一実行者について、指定の固定24時間窓を全ページ取得する。現在の「直近24時間」では指定窓の前半が欠けるため、必要なら7日表示から絞る。ログ本文・引数・回答内容は取得しない。
- [ ] 実行ID重複、失敗run、実行中run、所有者、JST/UTC、手動/Web/trigger種別を整理する。原本をrepo外へ置き、`node tools/form-maker-runtime-report.mjs <input.json>` で集計する。ツールの `complete:true` だけに頼らず、ページ取得漏れがないことも記録する。
- [ ] 公式consumer上限はtrigger合計90分/日。前計画の運用予算60分/日以内は余裕を確保する設計判断として継承する。観測値に作成・出力・再試行の余裕を加え、実測最大job時間の2倍を計画値として日次上限を決める。40予約枠と40件/日は別の制限として扱う。
- [ ] 停止中の短時間標本をopen時の保証にしない。Task 5の限定受付で空キュー確認・1job処理・同期重複時を測る。作成開始120秒以内、完了300秒以内、新規回答の反映180秒以内を初回目標として判定する。
- [ ] 不合格なら、まず繰り返す認証更新、停止中の不要通信、重複読取りを対象に最小修正する。現在の `formMakerWorkerIdToken_()` は呼出しごとにtoken更新するため調査対象とするが、キャッシュ等は計測・失効時の動作・UID取り違え拒否をテストしてから採用する。
- [ ] 待ち時間を変えるtrigger延長や日次上限の変更が必要なら、具体的な利用上の差分を提示する。有料化・別アカウントへの負荷逃避はしない。periodic処理・cadence・同期対象数を変えた場合だけ、影響を記録して新しい24時間窓を設定する。文書・UI・手動専用の認証修復だけで自動的に測定をやり直さない。

**Verify:** `npm.cmd run test:runtime-report`。背景負荷だけで60分を超える、欠測がある、または処理余裕がない場合は一般公開不合格。合格時は追加待機へ進まずTask 4以降へ進む。

### Task 3: 期限処理とログを、秘密を表示せず確認する

**Files:** F `worker/health.gs`、`worker/handoff.gs`、`worker/tests/{health,handoff,privacy-logging,trigger}.test.cjs`、release記録。
**Produces:** 限定した診断結果、期限処理の前後証拠、閲覧できたログ範囲と残る限界。

- [ ] 設定ページ全体の取得に代えて、必要なら `getFormMakerReleaseDiagnosticsV1()` を追加する。指定キーごとの `getProperty` だけを使い、出力を `accepting:boolean / acceptanceMode:test|open|invalid / trackedCsvCount:number / expiredCsvCount:number / lastCsvCleanupAt:number` に固定する。`release_diagnostics_returns_only_allowlisted_scalars` で返却keyの完全一致と型、fixture秘密値の不在をassertし、失敗→実装→成功を確認する。properties全体・token・応募者・メール・CSV本文を返さない。
- [ ] 承認済みCSVの期限と定期実行を照合し、期限後のscheduled run・cleanup時刻・対象entryの除去を結び付ける。`[]` や「run成功」だけでは合格にしない。
- [ ] 台帳が既に空で前後証拠を復元できなければ、過去の自動cleanupを証明できたとは書かない。同じ承認済み・既にゴミ箱のテストCSVだけを対象にした新しい期限処理試験を具体化する。期限切れのテストentryを1件再登録して次の定期処理で除去する試験として記録し、元の自動移動とは区別する。通常の台帳entryを上書きせず、ファイルの復元・再作成はしない。
- [ ] 閲覧可能なApps Script実行ログと生成ソースのログ出力を確認する。既存privacyテストで成功・共有失敗・認証失敗・例外の機微値混入を検査する。default GCPの未閲覧ログを「問題なし」と判定しない。
- [ ] full Cloud Loggingが既存権限で閲覧できない場合は、既存ログ＋ソース/テストで確認できた範囲と未監査範囲をまとめる。過去全ログ監査の代替として受け入れる判断だけを具体的に確認する。閲覧のためだけにCloud project変更や追加IAM権限を行わない。
- [ ] Firebaseの使用量と既存Blaze運用方針を再確認する。既存記録は利用中の毎日確認、無料枠75%または予想外課金で新規受付停止。budget通知を支払上限と扱わず、新しい課金サービスを追加しない。

**Verify:** `npm.cmd run test:worker` に上記ケースが含まれること。期限は正確な `expiresAt` と毎時処理/throttleから判断し、機械的な追加24時間待機にしない。
**Pass:** 期限処理が追跡対象だけに作用し、秘密を含まない診断と、ログ確認範囲の合意がある。

### Task 4: 公開候補と切戻しを固定する

**Files:** F `tools/{foundation-release-manifest.mjs,apps-script-release-dry-run.cjs}`、既存runbook、P/C/Fの実変更とテスト。
**Consumes:** Task 1〜3の合否。**Produces:** 最終候補manifest、24時間以内の復旧ソース対、公開順と復旧手順。

- [ ] 新しく変えた範囲だけを各PRへ反映し、そのCIを確認する。無変更の合格済みテストを何度も手動再実行しない。公開workflowが要求するmain上の検証は別途実行する。
- [ ] F: `test:worker`、`test:recovery`、`test:release-dry-run`、`node tests/apps-script-deployment-target-contract.cjs`。移行処理を変えた場合だけ `test:migration` も実行する。
- [ ] Pを変えた場合: `npm.cmd run build`、`node tests/deployment-contract.cjs`、`npm.cmd run test:history`、`npm.cmd run test:browser`。C Rules/adapterを変えた場合: `test:firebase:emulator`、`test:firebase:form-maker-admission`、`npm.cmd run test:react:unit`。Emulatorは `demo-circle-kikaku-tools` を使用する。
- [ ] Fのmanifestを `--portal-root <P> --worker-root <F> --circle-root <C>` で生成する。live欄が初期化されるため当日の観測を追記し、同じ引数で `--check` を通す。HEAD更新後は対応するmanifestも更新する。
- [ ] 候補artifactは `Code.gs / appsscript.json / targets.json / release-manifest.json`。push用directoryは先頭2ファイルだけ。復旧directoryに完全ソース対と `backup-manifest.json` を準備する。
- [ ] `node tools/apps-script-release-dry-run.cjs <candidate-dir> <rollback-dir>` が `status:ready / externalWrites:0` であることを確認する。秘密値はbackup-manifestへ入れない。認証修復をソースrollbackで取り消さない。
- [ ] ソース置換が必要ならtrigger一覧を保存し、稼働runを排出してから専用workerだけを更新する手順を固定する。Formsイベントtriggerが増えていた場合も対象を確認し、旧writerを一括停止しない。

**Pass:** 公開するSHA/hashと復旧対象が一致し、G0〜G3の未確認を合格へ丸めていない。

### Task 5: Rulesとbackendを限定受付で有効にする

**Files:** C `firebase/database.rules.json`、Fの保存候補・受付設定、P/F/Cのrelease記録。
**Produces:** 同じ予約枠契約で動くRules・worker、登録テストUIDだけの受付。

- [ ] freshなlive Rules backupと候補の意味的差分を示す。現時点の候補差分は `formMakerV1` 内の予約枠・test mode等。既存room Rulesに差分が増えていれば先に調べる。
- [ ] Rules公開は具体的なproject・差分・backupを示して実行時点で確認し、追加Rulesを公開する。すでに同じhashなら再公開しない。
- [ ] worker保存hashが最終候補と同じなら再pushしない。違う場合だけTask 4の手順で2ファイルを更新し、readback一致・health・trigger復旧を確認する。新しいWebデプロイは作らない。
- [ ] `acceptanceMode:test` とP/Cそれぞれのテスト所有者を設定する。許可UIDだけが予約・作成・出力でき、通常端末はメンテナンス表示になることを確認する。heartbeatや再起動でopenへ戻らないことも確認する。
- [ ] Task 2の限定負荷/待ち時間確認を完了させる。通常利用者を一時的に全開放して試験しない。失敗時は受付停止へ戻し、job・履歴・資産を保持する。

**Pass:** 正しい認証・Rules・保存ソース・trigger・test modeがそろい、負荷と期限処理が合格。通常受付はまだ開かない。

### Task 6: C → Pの順に本番公開する

**Files:** 既存C `react-production-release.yml`、P `deploy-pages.yml`、P `tests/production-pages-smoke.cjs`。原則workflowを作り直さない。
**Produces:** 公開C/PのSHA・成果物hash・成功workflow URL。

- [ ] F #28の最終レビュー/CIを確認してmainへ統合する。F workflowは候補生成だけであり、mergeをApps Script反映済みの証拠にしない。
- [ ] C #111を統合し、**同じmain SHA** の `Release / Readiness` 成功後、標準 `React Production Release` を実行する。公開 `release-build.json` のSHA/digest、対象route、検証room `P9A93LMQ` のcleanupを照合する。
- [ ] Cの公開成功後にP #19を統合する。Pはmainへのpushで `Deploy Pages` が動くため、mergeを公開操作として扱う。デプロイと `pages-production-smoke` の完了まで確認する。
- [ ] Pの公開URLへ `LIVE_URL=https://mutoshiki.github.io/sanpokai-kikaku-portal/` を指定し `node tests/production-pages-smoke.cjs` を実行する。この自動smokeはFirebase通信を遮断するため、描画検証であり実認証/同期の証拠ではない。
- [ ] 公開直リンク・再読込みで同一originの新画面を確認する。旧iframeが残れば配信asset・キャッシュ・workflowのSHAを調べ、受付はtestのままにする。

**Pass:** 公開C/Pが指定の成果物に一致し、両方の本番検証が成功する。

### Task 7: 公開画面を実操作し、合格後に通常受付を開く

**Test data:** 既存の専用企画 `P1C34AE0E8277438BBAE` は既存経路の確認に再利用。作成経路は専用テスト1jobで確認し、新しく発行されたform/project IDを記録する。再送・2タブは同じjobを使い、既存企画へ強制的に紐付け直さない。

- [ ] サイドブラウザでポータル→入力→作成受付→完了→コピー→履歴→企画表示まで操作する。実際のFirebase認証・書込み・worker処理を使い、mockや自動smokeで代用しない。
- [ ] 2タブ・再読込み・通信中断後の再開でフォームが増えないことを確認する。「企画を開く」は新タブで一度だけ開き、元タブをフォームメーカーのまま保つ。
- [ ] 同じテストフォームへ架空回答を送り、Formsイベント→許可項目だけの `applicationSync v2`→企画の応募者表示を照合する。時刻を記録してTask 2の目標を判定する。
- [ ] 架空回答の編集・削除を確認する。イベントが発火しない操作は毎時照合による反映として待ち時間を別記し、新規回答の180秒目標と混同しない。参加者・車割り・精算が書き換わらないことを確認する。
- [ ] 公開Cから書類出力を検証する。追加CSVが必要なら「新しい合成企画の架空1名だけ、登録済み編集者 `610unko@gmail.com` だけに共有、検証後ゴミ箱」の対象を示して一度確認する。既にゴミ箱のCSVは復元しない。内容・ACL・ログイン下の取得を個別確認する。
- [ ] 390/440/640/1280px、ライト/ダーク、黒いheader、横overflow、必須入力、コピー通知、キーボード/フォーカスを確認する。Safari/VoiceOver実機が利用できなければ未検証と明記し、WebKit成功で置き換えない。
- [ ] 枠解放、使用量増分、残存テスト資産、ゴミ箱移動を記録する。全件合格後に測定に基づく日次上限で `acceptanceMode:open` にし、status/UIの一致と通常端末の利用可否を確認する。

**Pass:** 公開URLで表示・作成・共有・履歴・回答・同期・企画表示・書類出力が個別に合格し、通常受付が有効。実行者が合否を判断して完了報告する。

## 必要なときだけユーザーへ依頼すること

| 場面 | その時点で提示する内容 |
|---|---|
| ログイン/MFA・ブラウザーでの認証情報入力/変更 | 対象アカウント、画面、必要な操作だけ。tokenを会話へ貼らせない |
| 新worker UIDへの権限付与・Rules公開 | project、対象UID/path、実差分、復旧元。準備済みの具体物を示して実行時点で確認 |
| 既存権限でCloud Logging全体を確認できない | 確認済み範囲/未監査範囲と、限定監査で公開する案を一度提示 |
| 新しいテストCSV等が必要 | 企画、架空人数、共有先、後片付け。既承認の対象だけで済めば再確認しない |
| 待ち時間や採用条件を変更する必要がある | 例:「作成開始を最大5分にすれば毎分処理を減らせる」など、利用者への影響を一文で説明 |

「続けてよいか」だけでは聞かない。本人対応待ちでも独立したローカル作業と読取りは進める。

## 切戻しと完了範囲

- 失敗時は新規受付を停止する。公開C/Pは検証済みartifactへ復旧し、壊れた旧iframeへ自動で戻さない。
- workerソースを戻しても更新済みの認証と旧UID失効を維持する。既存job・history・フォームを削除して帳尻を合わせない。
- 新規公開の完了後、必要な旧フォームだけを既存migration dry-run→form単位で旧writer停止→新writer登録→照合の順で移す。全件移行完了と新規公開完了を分けて報告する。
- 最終報告は公開URL、C/P SHA/digest、worker/Rules hash、実cadence/上限、実測時間、各操作の合否、残存テスト資産、実機未検証範囲を含める。

## 公式仕様とこの計画の判断

- [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas?hl=en): consumerのtrigger合計は90分/日、quotaは実行者単位。60分予算・作成120/300秒は既存計画の運用判断であり公式値ではない。
- [Firebaseのセッション管理](https://firebase.google.com/docs/auth/admin/manage-sessions): 管理者はrefresh tokenを失効できる。ID tokenの寿命と、RTDBのworker権限取消は区別する。「更新tokenを再発行するには必ず本人が手動コピーする」とはしない。
- 既存の24時間窓は終了済み。次に必要なのは集計と判定であり、毎回無条件の24時間待機ではない。

## 計画の自己確認

- [x] 既にCIを通過した実装を引き継ぎ、旧計画の現在地を更新した。
- [x] 認証露出対応、既存窓の集計、期限/ログ、復旧、公開、公開E2Eを工程に割り当てた。
- [x] 実在するテストコマンドを使い、旧計画にあった未定義のadapter用npm scriptを使わない。
- [x] 観測と実行済みの違い、追加待機の条件、限定受付と通常受付を明記した。
- [x] プロパティ全体を再表示せず、秘密を含まない診断と認証更新の手順を定義した。
