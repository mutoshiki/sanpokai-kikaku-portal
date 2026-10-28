# フォームメーカー公開 実行記録

更新日: 2026-10-16 JST
状態: 実行中。通常受付は停止したまま。公開と応募者データの処理は未実施。

## 対象基準

| 対象 | 現在確認した基準 |
|---|---|
| P portal | `fix/form-maker-history-timeout-recovery` / `c891684edaf69a76e27e32da7efb6d282fb39d9f`。dirty/untracked候補を保全中 |
| F form-builder | `codex/form-maker-carbon-ux` / `02c30f1ced42a6365583e5a85ee2bff45db8ff0f`。dirty/untracked候補を保全中 |
| C current checkout | `codex/react-migration-rc` / `7f5dd6d2c309500a4f05bd13828716b6feb0f432`。dirty/untracked候補を保全中 |
| C production baseline | `c234929b4b0c4adffadf1134893042087bb4c6c7`。公開manifest digest `329f9182e07ab6565f8c327f43c822d676ffc153c30539445cf38c17300ec570`。基準checkout `C:\Users\toshi\.codex\worktrees\form-maker-foundation-release\circle-kikaku-tools` |
| Apps Script | 対象は専用worker ID `1Z_fpG_nd4UazqRZKbZHhzlcTsD0jBEaUXIqCXmqNTmgg5edgLNljgx50`。サイドブラウザで `sanpokai.formmaker@gmail.com` を確認。旧A/B IDへ更新しない |
| Firebase | project `sanpokai-tool`。Chromeアカウントは `610unko@gmail.com` |

復旧コピー（2026-10-16 07:07 JST、repo外）:

- `C:\Users\toshi\Documents\form-maker-backups\2026-10-16\dedicated-worker-live\Code.gs` — SHA-256 `8b04d2b2985efd49ed1043f0ffcbd8418add79bdccd192b25f8d3d02516cea07`
- `...\appsscript.json` — SHA-256 `d73bcf1bf07f358e8b64e2c6bff0cc2ae8e035bb943a1bcfb4b227507333734f`
- `...\backup-manifest.json` — exact Script ID and source hashes, backup time 2026-10-16 07:07 JST
- Saved worker source does not match current generated candidate (`cc249eac786b136f1e5210545a024d9c3b5bbcc4c3c85429b60ccef23187b8d5`). Candidate must be reconciled and tested before replacement.
- Two dedicated worker triggers are owned by `sanpokai.formmaker@gmail.com`: queue every minute; application sync every five minutes. Last-run times were 07:04:53 and 07:04:32 JST respectively.
- Firebase current status: `accepting:false`, `state:paused`, `dailyCount:0`, `dailyLimit:40`, blank `errorCode`.
- Live rules raw SHA-256 `b118fe1b0b8c30ca4d87cab5ca60aca43afeed6e5939a6f320b238055a946bec`; `formMakerV1` has `workers`, `status`, `users` only. It has no test-only `acceptanceMode` or `testOwners` rule yet. The local C rules have additional changes and cannot be pushed wholesale.

## ゲート状況

- G0: 進行中。GitHub公開SHA/digestと専用workerの本人/IDを確認。remote保存ソースの完全backup/hash、trigger/owner、intake、rules hashの再確認が残る。
- G1: 未合格。過去の実行一覧合計は内部quota値ではなく、同一実行者の全scriptを含む測定も未完了。
- G2: 未合格。Cloud Logging、期限ledger、現在のBlaze使用量/予算通知の確認が残る。
- G3: 未合格。最終候補、backup、dry-run、manifest未固定。
- G4: 未合格。公開URLの限定受入は未実施。

## 作業記録

- 2026-10-16: dirtyなP/F/C checkoutを保持し、C mainの公開SHAに対する独立checkoutを用意。公開用Actions workflowと公開manifestを照合。専用Apps Scriptプロジェクトをサイドブラウザで開き、アカウント/ID/保存表示を確認した。
- 2026-10-16: 専用workerの保存ソース/manifestをローカルのrepo外backupへ複製し、完全な2ファイルとhashを確認。Firebase rules/statusもChromeで読み取り、受付停止と本番rulesの不足契約を確認。
- 2026-10-16: Fにoffline runtime集計器とCLIを追加。テストを先に作成してmissing-moduleで失敗することを確認し、実装後12件が通過。入力をrepo外に限定し、CLIは集計値だけを出力する。
- 2026-10-16: 本記録作成時点ではFirebase、Apps Scriptの保存コード/トリガー、GitHub Pagesのいずれも変更していない。

## 未確認・制約

- Google Apps Script UIから保存済みCode.gs/appsscript.jsonを完全backupし、candidateと照合する作業は継続中。
- 実行時間のUI合計はGoogle quota counterの直接値ではない。集計対象、失敗行、時間窓、実行者の検査が必要。
- CSVは事前承認済みテスト資産がゴミ箱へ移動済み。自動Drive移動の証拠とは扱わない。
- 公開後の実ブラウザ受入と、利用可能ならSafari/VoiceOver実機確認を別々に記録する。

## 2026-10-16 08:10 JST 再開記録
P/F/Cの候補テストを現在のdirty working treeから再実行した。P build、Pages契約、履歴31件、ポータル/フォームmaker browser smokeはPASS。F worker 70件、recovery、migration 11件、release dry-run 4件、script target契約はPASS。Cはoffline専用demo targetでReact 121件、build、RTDB既存rules/限定受付rules emulator、handoff browser 4構成をPASS。外部Firebase実データには書き込んでいない。

Apps Scriptの旧同期Head保存後の直近8回は完了/失敗0。平均11.379秒、最大21.373秒。1分間隔の単純換算は約273分/日で、現在のcandidateではquota gateを満たさない。短い速報であり、連続24時間測定ではない。旧同期の処理頻度と新規回答同期の180秒目標は独立した要件として扱う。保存前の過去ログに識別子/例外文字列混入を確認したが、既存logを削除せず、未閲覧期間を合格扱いしない。

通常受付は停止のまま。Firebase rules/worker push、trigger cadence変更、C/Pの本番publishは未実施。公開前に旧同期の負荷/遅延を両立する最終設定と24h観測が必要。ブラウザ実機Safari/VoiceOverは未確認。

## 2026-10-16 08:20 JST cadence update

ユーザーは追加サービスを使わず旧フォームの確認を10分間隔にする案を了承した。旧Apps Scriptの唯一の `syncManagedFormImports` triggerを10分おきに再作成し、Side Browserでアカウントを確認後、Triggers画面を再読込して1件だけ存在し保存値が「10分おき」であることを確認した。編集UIの保存が反映されなかったため、`applyLegacySyncCadence10MinOnce` を同じ旧プロジェクトの `auto-sync.gs` に保存して実行した。実行ログは08:18:52開始、08:18:53完了。新trigger作成が成功してから既存handlerのtriggerを削除する処理である。

同じ保存ソースの `FORM_IMPORT_TRIGGER_MINUTES=10`、`FORM_IMPORT_BATCH_LIMIT=30` を設定し、登録済み30フォームすべてを1回のrunに含めるようにした。回帰テスト7/7、Fのworker suite70/70 PASS。変更後のrepo外candidate SHA-256: `DF434002788E21922FDA65A9F332327A35B9F72576B1A7C4E7B43E61FFE7123A`。Apps Script editorは「Driveに保存しました」を表示し、再読込後に定数とmaintenance関数が保存済みであることを確認した。従って旧フォーム回答の定期反映は最大約10分を目標とする設定になった。最初の10分/30フォーム実行の完了・所要時間・遅延はまだ未確認。

このcadence/件数の最終変更保存を約08:20 JSTとして24時間観測を開始する。現在の予測はquota合格証拠ではない。応募者データを含む手動sync、実運用回答のテスト、旧A/Bのweb deployment、Firebase Rules/worker、C/P本番公開は未実施。Firebase受付は前回確認時点で停止中。G1/G2/G3/G4は未合格のまま。既存Blaze料金の最新日額、Cloud Logging全期間、cleanup ledger期限後の挙動を確認する。

## 2026-10-16 08:23 JST 監視・実行ログの追加確認

Chromeで `610unko@gmail.com` とFirebase project `sanpokai-tool` を確認。料金プランはBlaze。2026年10月の画面に「最近、請求対象Firebaseサービスを使用していません」と表示されているが、費用データは最大24時間遅れるため、確定済み請求額とは扱わない。Realtime Databaseは保存123.3MB/1GB（12%）、ダウンロード20.7MB/日・360MB/日（5.7%）。予算アラートは設定されていない。監視担当は同アカウントの運用者、利用が続く間は毎日確認する。RTDBのいずれかが無料割当の75%に達した場合、または想定外の請求対象項目が見えた場合は新規受付を停止し、既存同期を保全したまま原因を調べる。Blazeの料金が自動停止されるとは見なさない。予算アラートは未設定のままなので、料金ページの確認結果が遅れる可能性を引き続き記録する。

Apps Script実行一覧は「過去7日間」を表示。旧プロジェクトの `syncManagedFormImports` 08:18:42行を開いたところ、08:18:46〜08:18:52に汎用の `Form applicant sync failed.` が6件あった。行の表示状態は「実行中」で、完了としては数えない。これは10分trigger変更（08:18:51）より前の開始で、最終source保存（約08:20）より前の実行なので、10分/30件candidateの試験結果ではない。表示された6件には回答本文、メール、フォームIDは含まれなかった。Apps Script設定はGCP「デフォルト」で、任意のCloud project/log retentionはUIから特定できなかった。確認できたのは選択実行のCloud logsのみであり、10/15からの全ログ・未閲覧期間・GCP保存期間は未監査。`syncManagedFormImports` の次回10分実行の完了・所要時間・件数は未確認。

Chromeの現行使用量画面は以前の記録（20.7MB/日）を更新する読み取り時点の値として採用した。Cloud Logsの全期間監査、予算通知、CSV期限ledger値、期限後の定期cleanup結果は引き続き未確認で、G2は未合格。

## 2026-10-16 08:27 JST 旧同期の初回cadence確認

Apps Script実行一覧を再読込し、cadence変更後の `syncManagedFormImports` の最初の定期実行（08:25:34 JST）が24.054秒で完了したことを確認した。旧プロジェクトのトリガー一覧も再読込し、対象handlerは1件だけ、所有者は `sanpokai.formmaker@gmail.com`、一覧上の失敗率は0%。08:18:42開始の行はtrigger交換前に開始したため新設定のサンプルではない。起動時刻に揺れがあるため、正常な1件は24h合格の代わりにしない。

添付されたDrive風ポップアップは「現在ファイルを開けない」という表示だった。画像は対象URLやファイルID、Apps Scriptエディタの内容を示しておらず、ソースや同期の不具合を特定する証拠にはできない。実行一覧の別表示で確認した現在のworker実行は完了している。ポップアップの具体的なリンク先は不明のまま。

`git diff --check` は成功。CRLFへ変換される可能性について既存ファイルの警告のみ。受付は引き続きpaused。G1の連続24h、G2ログ/期限cleanup、G3最終候補、公開P/Cと実ブラウザ受入は未完了。

## 2026-10-18 10:10 JST 再開確認

- PのSafari/WebKit不具合を追加修正。window.localStorage のgetter自体が拒否される場合、既定引数の評価で画面がクラッシュしていた。保護範囲内で取得するよう修正し、回帰テストは修正前RED、修正後GREEN。
- Pの本番build、deployment-contract、履歴/session 32件、ブラウザsmoke（Chromium/WebKit、light/dark、390/1280px、same-origin作成・履歴、storage denied）を再実行しPASS。
- F/Cのworker、recovery、release dry-run、admission rules Emulator、既存Firebase rules Emulator、およびcross-repo candidate 80 SHA-256 checksを確認しPASS。git diff --checkは3 repoでPASS。既存dirty/untracked差分は保全し、commit/pushはしていない。
- Side Browserの sanpokai.formmaker@gmail.com で、専用worker sourceが09:55:17に保存済み、readback 2ファイル一致、queueは1分、application syncは1時間のまま。直近のqueue実行は10:09:53に2.617秒で完了。10:06:53のqueue実行詳細はCloudログなしと表示。これはこの実行1件の表示であり、全期間のCloud Logging/PII監査を証明しない。09:55以降のapplicationSyncはまだ実行履歴に出ていない。
- Chromeの 610unko@gmail.com / sanpokai-tool で、請求プランBlaze、最近請求対象Firebase利用なし（表示遅延あり）、今月の予算設定なしを確認。RTDB表示は123.33MB、ダウンロード490.74MB（2026-10-02〜11-01の表示期間）。既存方針は利用中の毎日確認、ストレージまたは日次downloadが無料枠75%到達、または想定外の課金項目が出たら新規受付停止。予算設定は変更していない。
- Firebase statusは10:03 JST読取りで accepting:false, state:paused, dailyCount:0, dailyLimit:40。live rulesやRTDBは変更していない。
- G1の新しい account-wide 24時間窓はworker source push時刻2026-10-18 09:55:17 JSTから開始。最短終了は2026-10-19 09:55:17 JST。現時点の成功runや従来の約52分/日の概算は24h実測の代わりにならない。受付停止と公開保留を継続。
- 残件: 全Cloud Logsの閲覧範囲/PII監査、CSV ledger cleanupの実scheduled evidence、account-wide 24h quota実測、Firebase live rulesのfresh exact backup/hashとsecurity-rule publish、限定受入、C/P標準release、公開URL実ブラウザE2E。通常受付は開かない。
- ローカル候補の本番Pages smokeを追加実行（2026-10-18 10:11 JST）。Vite preview http://127.0.0.1:4182/sanpokai-kikaku-portal/ へ向け、390px/1280px表示、dark theme、Carbon黒ヘッダー、同一origin form-maker、iframe 0、Firebase writes 0、page errors 0を確認しPASS。Cloud/CDNを介した公開URLの検査はデプロイ後に行う。

## 2026-10-18 10:15 JST 再開作業

- Fの保存候補を再検証: `test:worker` 78/78、`test:recovery`、`test:migration` 11/11、`test:release-dry-run` 4/4、Apps Script target contract、cross-repo manifest 80 SHA-256 checks がPASS。`test:migration` と `test:worker` はworker bundleを再生成した後に完了。
- Pの本番 smoke は新規実装の内容をローカルVite production previewで再確認し、390/1280px overflowなし、Carbon黒header、同一origin route、iframe 0、Firebase writes 0、page errors 0。公開URL/CDN確認は引き続き未実施。
- Side Browserの正しい専用worker（`sanpokai.formmaker@gmail.com`）では、10:12:53のキュー処理が3秒、10:13:53が12.663秒、10:14:53が2.405秒でいずれも完了。専用worker triggerはqueue毎分・application sync毎時の2件。Scripts設定値とworker status signatureは `accepting:false`, `paused`, `dailyCount:0` を保持。応募同期のpush後初回は次の毎時実行後に改めて確認する。
- 10:12:53の個別実行詳細を開きログ再取得を試したが、「この実行に関するログはありません」「最近の実行に関するログの取得で、遅延が発生している可能性」と表示。これはCloud Logging全期間監査ではない。
- worker専用実行一覧（過去7日間、失敗filter）では16件が表示され、最新の失敗は10/16 23:39:53 JST。10/18 09:55以降の失敗は表示されていない。10/16 23:36/23:39の選択ログはGoogle側の一時server error、10/15 16:56はbundle内の宣言重複、19:14の応募同期失敗は `FORM_IMPORT_BATCH_LIMIT` 欠落。選択ログに回答・メール等は見えず、最後の2件の原因は保存bundle生成と回帰テストで修正済み。ただし、一覧の全16件の詳細や未取得Cloud Logsを確認したわけではない。
- Apps Script設定画面ではGCPが「デフォルト」。Google公式仕様ではデフォルトCloud projectは通常ユーザーがConsoleから直接閲覧できず、Cloud Consoleでの完全なLogs Explorer確認にはアクセス可能なstandard projectが必要。プロジェクトをstandardへ切替えると再認証等の影響があるため今回の確認だけを目的に切替えない。現行Apps Script dashboardの個別ログ欄で確認できる範囲を記録し、未閲覧範囲をPIIなしと判定しない。
- G1は保存後の同一実行者全Apps Script 24時間観測が必要。基準時刻09:55:17 JST、判定可能時刻は2026-10-19 09:55:17 JST。現時点は約20分の部分観測のみで、受付paused、一般公開保留を維持。

## 2026-10-18 10:19 JST 料金・失敗履歴の更新

- Chromeの `610unko@gmail.com` / Firebase project `sanpokai-tool` を再確認。Blaze、10月請求周期の費用表示は「発生していません」だが最大24時間遅延の注記あり。RTDB storage 123.3 MB / 1 GB (12%)、download 20.9 MB / 360 MB/day (5.8%)。
- 「アカウントと予算」を開き、予算アラートなしを再確認。設定変更はしていない。従来方針どおり運用者が利用中に毎日見て、無料枠75%または予想外課金で新規受付を止める。アラートはハードな料金上限ではない。
- Worker 7日間の失敗filterは16件、最終は2026-10-16 23:39:53 JST。10/18の保存後失敗は一覧にない。調査した詳細ログはGoogle側server error 2件、bundleの重複宣言1件、旧応募同期のbatch定数欠落1件で、これら表示内容に応募全文/メールはなかった。後2件は修正しgenerated bundle testsで検証済み。残る詳細やdefault GCP projectの未閲覧ログ範囲は未監査とする。

## 2026-10-18 10:22 JST 再開後のローカル再検証

- Fの`test:worker`を再実行し78/78 PASS。`test:recovery`の同期・作成・管理診断・Firebase room safety・create-form各契約がPASS。`test:release-dry-run`は4/4、専用Apps Script target contractもPASS。
- Pのproduction buildが成功。`test:history`は32/32とApps Script history bridge smokeがPASS。`test:browser`はCarbon theme、keyboard/focus、同一origin history/creation、form-maker操作smokeがChromium/WebKitでPASS。公開Cloud/CDNの確認とは区別する。
- F runbookを実状態に合わせて更新。専用workerはqueue毎分・application sync毎時を既に持ち、10/18 09:55のsource pushはtriggerを変更していない。push後の毎時syncと期限ledger処理の確認は未実施。CSVは事前に手動でDriveゴミ箱へ移動済みなので、自動のDrive状態遷移は証明対象外。
- Side Browserのworker trigger一覧を10:20 JSTに再読込。`sanpokai.formmaker@gmail.com`、専用Script ID、2件、所有者「自分」を確認。queueの前回実行表示は09:56:53、application syncはまだ実行時刻なし。次の予定syncは直近の09:44:32実行から約1時間後の10:44頃を見込み、実行後に期限処理・安全な設定値を再確認する。
- 24時間quota窓は09:55:17 JSTに開始済みで、終了予定は10/19 09:55:17。現在の部分観測は合格判定に使わず、受付pausedを維持する。
- Firebase rules/RTDB、受付、Pages/Circle公開は変更していない。Firebase rulesの公開は実行時点の正確なlive backup/hashとaction-time確認が必要なため保留。
