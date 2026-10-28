# フォームメーカー基盤再構築 実装計画（無料運用を前提）

更新日: 2026-10-16（日本時間）

残作業の実行順・公開判定・切戻し: [2026-10-16 公開までの残作業 実行計画](2026-10-16-form-maker-release-execution-plan.md)。本書の実装済み記録を保持し、以後の公開作業は補足計画に沿って進める。

状態: ローカル実装と限定合成受入は進行中、公開前ゲート未通過。新しい全体受付枠はP/C/Fのローカル候補に実装し、Firebase Emulator・worker・ブラウザ契約テストで確認済み。2026-10-15に架空企画のフォーム作成・回答・Firebase同期・企画画面表示を実ブラウザで確認し、Task 6の合成CSV生成・Drive権限も確認した。CSVは確認後にゴミ箱へ移動済み。新しい受付枠ルール・クライアント・worker候補は未公開。2026-10-16に Apps Script の直近24時間の実行一覧を合算した結果は約511分で、gmail.com等の個人アカウント向け公式上限90分/日を大きく超えるため、quotaゲートは不合格として公開を止める。Apps Script candidate/rollbackのローカルdry-runは実装・テスト済みだが、実trigger停止・push・rollback、Drive自動TTLの実時間確認、Cloud Logging全体のPII監査、旧フォーム移行、Pages公開後の実ブラウザ確認は未完了。受付は停止中。直近で記録したFirebase Blaze当月表示額は$0.00だが、公開前に再確認する。

> 実行担当者は、`superpowers:executing-plans` に沿いtaskごとに進める。ユーザーの指示なく別エージェントへ委任しない。下記の新規ファイル名・コマンドは実装予定であり、現時点で存在・成功を保証するものではない。

**Goal:** 既存の無料サービスを使い、フォーム入力画面をApps Scriptのブラウザセッションから分離し、作成・履歴・応募同期を回復可能にする。

**Architecture:** GitHub PagesのReact画面 → Firebase匿名認証とRTDBの所有者別ジョブ → Apps Script定期トリガー → Google Forms/Sheets。結果と履歴はRTDB、応募は既存applicationSync v2へ記録する。新たな有料サービスは追加しない。Firebase Consoleでは既存のsanpokai-toolがBlazeプランのため、RTDB無料枠内であることと予算監視を確認してから受付を開く。

**採用前の条件:** 無料枠、作成待ち時間、worker認証、乱用対策、書類出力の互換性を実証する。成立しない場合は無料の代替または範囲縮小を比較し、有料化しない。

**設計:** [再設計案](../specs/2026-10-15-form-maker-foundation-redesign.md)

## 対象と作業境界

- P = `C:/Users/toshi/Documents/GitHub/sanpokai-kikaku-portal`。画面と履歴表示の正本。
- F = `C:/Users/toshi/.codex/worktrees/form-maker-carbon-ux/sanpokai-form-builder`。既存候補の保全とGoogle worker実装。実行時にworktree・branchを再確認する。
- C = `C:/Users/toshi/Documents/GitHub/circle-kikaku-tools`。DBルールの正本と書類出力の薄い接続部分だけ。中止済みの全面Carbon再設計を再開しない。
- Apps Script実行主体は `sanpokai.formmaker@gmail.com`。Firebase管理は `610unko@gmail.com`。ブラウザの `/u/1` だけでアカウントを判定しない。
- 無関係な変更・未追跡ファイルをreset、stash、削除、一括commitしない。候補のUI・バックエンド変更を公開版と同一扱いしない。
- 実フォーム・回答・room・既存履歴を削除して作り直さない。新規テスト企画と架空回答だけで書込み検証する。

## 契約案

- `CreateRequest`: `jobId, protocolVersion, input, inputHash, requestedAt`。UIDは認証パスから決定。clientがworker権限・結果・formIdを指定できない。
- `JobState`: `queued | running | completed | partial | failed | unknown`。確定時刻はworkerが設定。
- `FormResult`: `formId, formUrl, editUrl, projectId, projectUrl, responseSheetUrl, stepResults`。秘密トークンと回答全文を通常履歴に含めない。
- RTDB: `formMakerV1/users/{uid}/jobs/{jobId}` を履歴を含む唯一の正本とし、worker専用registryを使う。`history/{formId}` の複製ノードは設けない。ルールと履歴の所有権をEmulatorで先に検証する。
- clientの要求作成はETag付きconditional PUTで一度だけ許可する。重複pending索引は持たず、同じjobIdの競合はHTTP 412で照会へ回す。既存jobの入力変更とclientによる結果の捏造を禁止。
- 端末履歴は固定名Firebase App `sanpokai-form-maker-v1` のUIDで継続する。room用の一時Appと混同しない。

## Task 0: 公開版と無料運用の前提を確認する

**Files:** P/Fの既存release記録、F `docs/releases/form-maker-free-baseline.md`（新規候補）。

- [x] cwd・branch・dirty state・AGENTSを確認。旧候補、公開HEAD、公開固定版を別々に保存し、秘密をログやGitへ出さない。
- [x] 現行Bのデプロイ・ソース、旧Aへの依存、トリガーと実行主体を照合する。過去の別Script v26修復と混同しない。
- [x] createForm・同期の実行失敗、Firebase 401/403を別の障害として調査し、未取得の例外は未解明と記録する。
- [x] RTDB Blazeプランと利用量、workerのAuth・ローカルルール、Apps Scriptトリガーと実行時間を読み取る。契約プランは変更しない。
- [x] 無料枠と利用量の概算、待ち時間の受入目標を記録。新規projectや有料サーバーを必須にしない。

**追記:** 2026-10-15にサイドブラウザの `sanpokai.formmaker@gmail.com` で専用workerの直近実行を確認。queue (1分) と application sync (5分) の完了実行が表示された。今回のDriveエラーURLに含まれる `Mabut0p2i5NY6AxsooZY22P9-mCOf3Byv` はmanifestのScript IDと違うため、承認失敗・worker停止の証拠に数えない。作成負荷の測定と全体受付上限は未完了。

**2026-10-15 19:43 JST 実行履歴再確認:** 正しい専用Script IDの「過去7日間」実行一覧は54件。queueは1分、応募同期は5分間隔で継続し、直近の完了履歴は成功。19:14:14の同期失敗は `FORM_IMPORT_BATCH_LIMIT is not defined`。bundleへ欠落定数を追加した後の同期実行は成功している。成功した19:35:42の同期はApps Script実行ログなし。失敗ログには定数名とスタックのみが表示され、応募者値は見えていない。ただしCloud Logging全体のPII監査は未実施。直近の受付停止後の空キュー実行時間から単純換算した専用worker消費は約30〜33分/日。これは短時間の標本であり、同一アカウントの他スクリプトを含む24時間quota測定ではない。全体quotaゲートと未処理件数の強制上限は未通過。

**2026-10-15 20:52 JST trigger復旧:** ソース保存を試す前にrunbookどおり既存2本を一時削除したが、ブラウザの安全制限によりローカル候補の読み込みが拒否されたため、Apps Scriptコードは変更していない。同じ専用Script IDでqueueを1分、application syncを5分として再作成し、一覧に所有者「自分」の2本が表示されることを確認。queueは20:51:53に成功。syncは再作成直後で初回実行待ち。受付はpausedのまま。次回のsync完了を確認後に設定が安定したと記録し、コード更新には別の安全な受渡し手段が必要。

直近7日表示中の新しい実行から、完了したqueue 37件は平均2.329秒（中央値1.316秒、最大15.687秒）、sync 8件は平均1.595秒（中央値1.293秒、最大5.049秒）。設定頻度で単純換算すると合計約63.6トリガー分/日。Google個人アカウントの公表上限90分/日と比べると余裕は大きくなく、同じ実行者の旧同期等を含んだ終日測定が必要。短い標本のため、これは合否判定ではない。詳細はform-builderの `docs/releases/form-maker-free-feasibility.md`。

**完了条件:** 比較対象、保全対象、処理主体、無料枠の余裕と未解明事項が区別されている。

## Task 1: RTDB契約と権限をローカルで確立する

**Files:** F `contracts/{jobs,history,application-sync-v2}.json`、`tests/form-maker-rules.test.mjs`、C `firebase/database.rules.json` と既存ルール検証設定。

- [x] 未認証・別UID・全体一覧・履歴直書き・結果捏造・入力の事後変更を拒否するEmulatorテストを作成し、実行。
- [x] 所有者だけの要求作成・照会と、workerだけの処理・結果更新を実装する。既存roomルールの意味を変えない。
- [x] 要求を単一job pathへconditional PUTし、同じjobIdの再送・競合・worker遷移を検証する。secondary pending indexは設けない。
- [x] 40個の共通予約枠を追加し、同時要求で上限を超えないこと、満杯・停止時の拒否、所有者間の読取り分離、worker解放をFirebase Emulatorで検証する。公開済みルールへの反映はTask 7で行う。
- [x] worker UIDの追加・失効テストを定義。clientが自分をworkerに登録できないことを確認。
- [x] 既存room fixtureを不変に保ち、Emulatorで合格後に対象差分だけcommitする（C: `d7ae2e6`）。

**完了条件:** clientは他人の履歴を読めず、処理完了を偽装できない。ルール正本はCのみ。

## Task 2: 無料の処理経路を先に実証する

**Files:** F `worker/{firebase-client,queue,trigger,health}.gs`、`worker/tests/{auth,queue,limits}.test.cjs`、`docs/releases/form-maker-free-feasibility.md`。

- [x] 専用Auth UIDのREST認証、更新・無効資格情報・ルール拒否、UID取り違えをテストする。
- [x] Script Propertiesに資格情報を保持し、値を出力しないFirebase接続を実装。既存refresh tokenを無検証で流用しない。
- [x] 専用Script IDを明示し、旧A/Bにpushしない候補workflowへ変更。Apps Scriptユーザーの割当は共有されると記録。
- [x] 1分トリガー、空キュー確認、公平な取得、Lock/lease、処理時間上限、backoffを実装。実workerはpaused状態で確認。
- [x] 空キュー時の短時間標本を計測（受付停止後の値から約30〜33分/日と換算）。
- [x] Apps Script「過去24時間」実行一覧を集計する。2026-10-15 05:28:42〜2026-10-16 05:27:53 JST相当の2,372件は合計約511.02分。旧 `syncManagedFormImports` trigger 1,440件/約475.07分、worker関連899件/約34.56分、その他33件/約1.39分。旧同期 trigger の所有者は現在の `sanpokai.formmaker@gmail.com`（UIの「自分」）。公式表ではgmail.com等のconsumer accountのtrigger total runtimeは90分/日。現状負荷は設計条件に適合しない。実行一覧の7日error rate表示は旧プロジェクト44.58%。
- [ ] 新規要求の実作成開始・完了待ち時間と、新workerだけを加えた安全な負荷を測る。既存同期の実測総量は上記のとおり超過しており、現行cadenceのまま本番公開しない。
- [x] 1日40件の処理上限と停止機能を実装・実環境で確認。
- [x] 未処理件数をサーバー側で強制する40件の予約枠を実装し、匿名UIDをまたぐ競合・満杯時の明示拒否をEmulatorで確認する。公開環境での有効化確認はTask 7に残す。

**完了条件:** 無料枠と実際の待ち時間が運用条件を満たす。失効時に資産を作らず安全に止まる。現状の24時間実測はquota条件を満たさず、Task 7の公開は停止。旧フォーム移行または処理頻度/処理時間の安全な見直しと、変更後の再計測を先に行う。

**任意の別実証:** 即時性が必要な場合だけCloudflare Workers FreeでApps Scriptの起動を中継する案を比較する。認証・HMAC・redirect・CPU・要求数の無料上限を実測する。Workerの終了後に処理が続くと仮定せず、RTDBジョブ＋定期処理を回復経路にする。有料Queues等を追加しない。新サービス作成はこの選択を確定してから行う。

## Task 3: 作成・二重作成抑止・回復を実装する

**Files:** F `worker/{creation,journal,recovery}.gs`、`worker/tests/creation-recovery.test.cjs`。

- [x] 連打・2タブ再送・作成直後の停止・DB応答消失・共有だけ失敗・room衝突を含むworkerテストを作成。
- [x] jobIdと入力hashを束縛し、既存jobを再開。Forms作成前の台帳・title markerを保存し、作成後はformIdを記録。
- [x] markerと台帳で照合できない結果をunknownで残す。新jobへ自動振替しない。
- [x] フォーム・シート・共有・企画初期化・同期登録の個別結果を保存し、部分結果を返す。
- [x] 新規roomだけを条件付きで初期化し、既存room全体を上書きしない。作成数・日次上限を実装。
- [x] 未処理job数の全体上限をサーバー側予約枠で強制し、上限超過を明示的に返す（Task 2の受付上限ゲート）。EmulatorとP/F/Cローカル契約テストで確認。公開はTask 7待ち。

**検証:** `node --test worker/tests/*.test.cjs`（作成予定）。各停止境界で同じjobが別資産を作らないこと、曖昧なら停止することを確認。

## Task 4: 応募同期を移す

**Files:** F `worker/{responses,sync}.gs`、`worker/tests/application-sync.test.cjs`、既存応募同期契約テスト。

- [x] 新規・同件数の編集・削除・0件・権限拒否・割当制限・古い結果の遅着をworkerテストで検証。
- [x] 既存response keyとapplicationSync v2を維持。許可項目だけを出力し、読取り失敗を0人として書かない。
- [x] form単位のwriterと世代を確認してから `meta/applicationSync` だけを更新。参加者・車割り・精算を変更しない。
- [x] 失敗formのbackoff、公平なcursor、処理上限、最終成功時刻、安全なエラーコードを実装。

**完了条件:** 回答編集・削除が反映され、不要な個人情報がDB・ログへ入らない。作成と同期の合計負荷が無料枠内。

## Task 5: 画面とポータル履歴を同じoriginへ統合する

**Files:** P `src/features/form-maker/*`、`src/services/form-maker-session.js`、既存履歴adapter、`public/form-maker/index.html`、画面・履歴のテスト。

- [x] Google/Apps Scriptのdocument要求が失敗しても入力画面が表示される同一originブラウザテストを作る。
- [x] Carbon画面を同一origin React entryへ移し、`google.script.run` をRTDB job受付・照会へ置換。
- [x] 入力・認証準備・履歴・queued・running・完了・部分成功・unknownを分けて表示。
- [x] 履歴の遅延で入力を塞がない。認証不能でも入力を残し、再読込みは保存済job IDの照会へ戻る。
- [x] 旧履歴を非破壊で読み、重複と不明日時を処理。任意formIdから所有権を推定しない。
- [x] 履歴を同一originで共有し、コピー通知、黒いCarbonヘッダー、完了フォーカス、別タブの企画リンクを確認。
- [x] 390/1280px、ライト/ダーク、キーボード、sessionStorage拒否を検証。440/640pxと切断後再接続は未確認。

**検証:** Pのbuild、既存履歴テスト、新規ブラウザテスト。利用中の複数Googleログイン済みサイドブラウザでも操作する。

## Task 6: 書類出力の無料経路を検証する

**Files:** F `worker/handoff.gs` と検証、Cの書類出力adapterと `ProjectTools.jsx`、必要な生成元、C `firebase/database.rules.json` とEmulatorテスト。

- [x] 新フォームを旧Aへ送らない振分けと、所有者認可を先に検証。room IDだけで出力を許可しない。worker-v1のformだけをproject ID + capability hash + editorで一意に認可。
- [x] PとCは別originのため匿名Auth UIDが共有されないことを確認。Cの追加ルールはUID別handoff jobとし、workerがtoken hashを照合する。token本体はRTDBへ置かない。Emulatorで他UID拒否、worker遷移、PIIを含むresult拒否を検証。
- [x] 固定名AuthをP/Cで共有せず、既存の引き継ぎcapabilityを使用。新フォームtoken hash保管、job処理、旧Aへ送らない経路を実装し、worker suiteとEmulatorで検証。
- [x] Drive引き継ぎ要求も共通40枠を先取りし、完了後にworkerだけが予約を解放する契約を追加。workerとEmulatorのテストで確認。
- [x] 出力ジョブから既定の編集者だけに共有するDriveファイルを作る候補を実証する。別UID・任意共有先・201件・同名の取り違え拒否はローカルworker/Emulator契約テストで確認。実ブラウザでは専用の合成企画からCSVを1件生成し、所有者と登録済み編集者だけ、一般アクセス「制限付き」であることを確認。
- [ ] 学籍番号等をRTDB・Apps Script実行ログへ記録しないことを確認する。成功した同期実行にはログがなく、確認できた失敗ログにも応募者値は含まれなかった。Cloud Logging全体の確認は未完了。
- [x] 合成CSVの限定内容、Googleログイン下での取得、登録済み編集者のみのACL、24時間後削除の表示、検証後の手動ゴミ箱移動を確認。
- [x] 現行live handlerは受付paused時にcleanup前でreturnする。cleanup対応候補をユーザーが専用Scriptへ貼り付けて保存した。プロジェクト履歴と保存後の定期実行成功を確認したが、保存版の完全なソースを独立して取得できず、ローカル候補とのbyte-for-byte一致は未確認。
- [ ] 受付停止を維持したまま、保存済みコードが期限切れ台帳entryを削除することを24時間後に確認する。対象CSV自体は既に手動でゴミ箱にあり、この確認は自動cleanup処理の実行証拠に限る。別CSVの復元・再作成やゴミ箱を空にする操作は行わない。
- [x] 旧フォームのtoken取込み・URLからの除去・旧出力経路を保持。生成済みdomainを直接修正しない。

**完了条件:** 無料で必要書類を権限付きで取得できる。成立しなければ未完了として新フォームの全面切替えを止める。UI刷新とは別に判定。

## Task 7: 公開と切戻しを再現可能にする

**Files:** F `deployment/form-maker-targets.json`、限定公開workflow、release manifest、Pの既存Pages workflow、Cルールの既存公開経路。

- [x] Apps Script workflowを旧A/Bへのpushから切り離し、専用worker向けのテスト済み候補artifactだけを生成するよう変更した。公開push/deployは行わない。
- [x] P/F/CのソースSHA、RTDBルールhash、worker Script ID、実トリガー所有者/設定、protocolをまとめたrelease candidate manifestを更新し、現在のローカル候補は54件のsource/build SHAと対象IDを照合。2026-10-15 19:43 JSTに実トリガー2本（queue 1分、application sync 5分、所有者は指定アカウント）を再確認し、実受付停止状態と公開済みRTDBルールを記録した。これは日付付きローカル候補であり、公開直前の再確認は必要。generator再実行時はlive情報を初期化するため、実測を再取得して追記する。
- [x] 実トリガー停止・実行中runの排出・再開を含むpush/rollback順をrunbookへ明記。実運用でtriggerを止める試験は未実施。
- [x] 互換ルール→worker→circle adapter→UIの公開順と、受付済みjob・履歴・実フォームを残す復旧手順をrunbookへ明記。実データrollbackは未実施。

- [x] トリガーが保存済みコードを実行する点を踏まえ、コード更新中のトリガー停止・実行終了確認・再開と復旧手順をrunbookへ明記。Webデプロイ固定版だけで巻き戻せると仮定しない。実運用でtriggerを停止する試験は未実施。
- [x] 誤Script ID、旧A/B、対象project不一致、hash不一致、許可以外のpush file set、rollback欠落/hash不一致を外部書込み0件で拒否するpreflightを追加・テスト。
- [x] 順序を互換ルール→専用workerと検証→circle adapter→新UIとしてrunbookに明記。旧A/Bを更新するworkflowは使わない。
- [x] 公開停止後も受付済みjob・履歴・実フォームを消さず、確認済みの復旧手順へ進む運用をrunbookに明記。起動しない旧iframeへ自動で戻さない。

**Apps Script pushの注意:** bundle置換前の初回調査では `コード.gs`、`form-support.gs`、`managed-sync.gs` の3コードファイルを確認したが、時刻は特定できていない。後続の19:43 JST再確認では保存ファイルが `appsscript.json` と `コード.gs` の2つになっている。候補は `worker/*.gs` を完全な `Code.gs` へbundleし、manifestと合わせた2ファイル構成を維持する設計。公式 `clasp push` はオンラインプロジェクト全体の内容を置き換えるため、ステージングフォルダはこの2ファイルだけに限定し、旧helper機能がbundleに含まれることと公開前バックアップを確認する。バックアップJSON等を含む作業用Tempフォルダから直接pushしない。

**完了条件:** 課金サービス追加なしで同じ成果物と実行ソースを特定でき、データを消さず切り戻せる。

**2026-10-16 release safety追加:** workflow artifactへ `appsscript.json` のSHA-256を追加。Fに外部書込み0件のApps Script candidate/rollback dry-runを追加し、専用Script ID/Firebase project、許可された2ファイル、candidate両hash、rollback対象・両hash・バックアップ時刻を検証する。candidate/誤対象/hash drift/rollbackのローカルケースは `npm run test:release-dry-run` で確認。実際のtrigger停止/push/rollbackはquotaゲートを理由に未実施。

## Task 8: 旧フォームを一件ずつ移す

**Files:** Fのdry-run移行ツール、旧schedulerのform単位停止adapter、移行台帳とテスト。

- [ ] 最初は新規テストフォーム、その後は新規フォーム限定。旧履歴だけから旧フォームを自動登録しない。
- [x] Fに秘密を出さないinventory dry-runを実装。重複ID、対象Script ID、response key契約、writer/status、未知フィールドを検証し、外部書込み0件をテスト。
- [x] 旧writerをform単位で止めるadapterと専用workerへの登録処理を実装。active lease中は停止を拒否し、dry-run/worker/recovery testsで確認。
- [x] 切戻し時の専用worker form pause adapterを実装。worker停止が同じformで確認されるまで旧writerを再開できないガードを追加し、対象テストで確認。
- [ ] 実フォームのmetadata inventory作成、専用1件の本番受入、後続batch移行は未実施。quota差異の解決後に合成フォームから開始し、旧履歴だけで自動登録しない。
- [ ] 旧依存がなくなった後だけトリガー停止・A/B保管を検討。実フォーム・回答の永久削除は含めない。

**完了条件:** 各formのwriterは一つ。既存ID・回答・参加者・精算を保持する。

**2026-10-16 ローカル再開追記:** 移行候補に外部書込み0件のdry-run、旧formごとのpause/register、専用worker側のrollback pause、同一formの停止確認なしに旧writerを戻せないガードを追加。F `npm run test:migration`, `npm run test:worker`, `npm run test:recovery` は成功。実フォームの移行はしていない。Apps Scriptの24時間実行時間がconsumer公式上限と整合しないため、quota差異を解明し受付停止を維持するまでTask 8の実データ移行とTask 9公開受入は行わない。

## Task 9: 公開環境で受け入れる

- [ ] 現在のGoogle複数ログイン済みサイドブラウザで、一覧→入力→受付→作成完了→共有→履歴→企画を操作する。元タブが勝手に遷移しない。
- [ ] 同じ専用フォームへ架空回答を送信し、Firebaseのv2 snapshotと企画画面の応募者表示まで照合する。
- [ ] 回答編集・削除、2タブ再送、通信断、履歴失敗、別UID拒否、書類出力を確認する。
- [ ] 作成初動・完了・同期の時間とApps Script/RTDBの使用量を記録。無料枠と応答速度の採用条件を確認する。
- [ ] 390px、テーマ、コピー、キーボードを確認。Safari/VoiceOverは実機の実施可否を別記し、別ブラウザ成功で代用済みにしない。
- [ ] 同じmanifest・同じテスト企画で各段階の証拠、作成物、残存テストデータ、未検証項目を記録する。

**最終完了条件:** 起動・作成・共有・履歴・回答・同期・企画表示・書類出力を個別に確認し、設計の条件を満たす。HTTP 200、ローカルbuild、匿名ブラウザだけの成功で全体完了にしない。

**2026-10-16 05:22 JST ローカル再開記録:** 40枠の共通受付をC RTDBルール・Emulator、React adapter、Pフォーム受付、F Apps Script workerへ実装。満杯時の新規作成拒否、owner間分離、同一要求の再開、端末横断の競合、worker完了時のETag一致解放、孤立枠の期限回収を追加検証した。確認コマンドはC `npm run test:firebase:form-maker-admission`、`npm run test:firebase:emulator`、`npm run test:form-maker-admission-adapter`、F `npm run test:worker`、P `npm run build`、`npm run test:history`、`npm run test:browser`。初回フォーム画面テストの失敗はFirebase mockが新しいslot endpointを持っていなかったためで、mockを追加後、単体と全browser suiteが通過。Emulatorルール公開・Apps Script保存・Pages公開はまだ行っておらず、候補SHA一致・rollback dry-run・公開後E2Eも未完了。受付状態はpausedを維持する。

**2026-10-16 05:29 JST quota再確認:** サイドブラウザで正しい `sanpokai.formmaker@gmail.com` を確認し、Apps Scriptのグローバル実行一覧を「あと24時間」で取得。実行を保持したまま12ページ（2,372行）を集計し、合計約511.02 trigger分を算出。内訳は旧 `syncManagedFormImports` が1,440実行・約475.07分、新workerが899実行・約34.56分、その他33実行・約1.39分。旧プロジェクト詳細では所有者「自分」、トリガー一覧の `syncManagedFormImports` も所有者「自分」。旧トリガー編集UIとソースは読み取りのみ。Google公式quotaページのconsumer（gmail.com等）のtrigger総実行時間は90分/日。実行ログと公開quotaの差異を放置せず、旧syncの実行所有者/実際のquota分類を確定し、旧フォームのwriterを維持しながら負荷を下げる方法を決めるまで受付再開・公開を行わない。実行一覧7日概要の旧プロジェクトerror rateは44.58%。公式資料: https://developers.google.com/apps-script/guides/services/quotas

## 不合格時

無料枠、待ち時間、権限、未知の作成結果、書類互換の問題があれば一括切替えを止める。無料中継の実証・処理の軽量化・運用上限・範囲の見直しを比較する。有料化は自動の次工程にしない。

この文書の作成・修正によって費用は発生していない。新しい有料サービスや課金設定の変更は本計画に含めない。

**2026-10-15 19:43 JST 実行継続記録:** 計画の「実装を進める」指示に基づき、専用Script IDの実行一覧を正しいアカウントで再確認した。実トリガーは1分/5分で稼働、観測上の直近エラー率は0%。一度の同期失敗はbundleの定数欠落で説明でき、修正版の後続同期は成功。workerは `accepting:false`, `state=paused`, `dailyCount=2`, `dailyLimit=40` のまま。CSVは既にゴミ箱で照合済み。24時間経過前のため自動削除はまだ確認できず、終日quota計測も未完了。未処理jobの全体強制上限がソースにないため、このゲートも残す。これらを理由にPages公開・既存フォーム移行は行わない。
## 現在の実装状態（2026-10-15 20:52 JST）

- Pの同一originフォーム画面、二重作成防止、job照会、履歴反映はローカルブラウザで確認済み。履歴遅延時の入力継続、失敗回復、企画引き継ぎも確認した。Pagesの公開反映と公開URLでの操作は未実施。
- 指定アカウント `sanpokai.formmaker@gmail.com` の専用Script ID `1Z_fpG_nd4UazqRZKbZHhzlcTsD0jBEaUXIqCXmqNTmgg5edgLNljgx50` に保存されたファイルは `appsscript.json` と `コード.gs` の2つ。19:18に合成フォームと回答を作成し、19:35にFirebase `applicationSync` v2とCircle企画画面への応募者表示を確認した。Drive CSVとACLも確認し、CSVはユーザー承認に基づき手動でゴミ箱へ移動した。既存A/Bには変更を加えていない。
- 現在の受付状態は `accepting:false`, `state=paused`, `dailyCount:2`, `dailyLimit:40`。実トリガーはqueue 1分・sync 5分、指定アカウント所有で、19:43時点の直近エラー率は0%。ただし過去のbundle欠落による同期失敗は履歴に残る。
- 受付停止中の短時間標本は約30〜33分/日の単純換算。先行する短い標本では約63.6分/日も観測された。いずれも同一アカウント全スクリプトを含む24時間計測でも、連続要求を含む負荷試験でもない。待ち時間とquotaの採用条件は未通過。
- Cの加算的formMakerV1ルールとhandoff契約をEmulatorで検証し、sanpokai-toolのルール公開も完了した。FirebaseはBlaze、当月表示額$0.00（18:56確認）。予算アラート・監視の判断と受付上限の合意は未完了。
- Fのローカルworker bundleはcleanupをpaused状態でも呼ぶよう変更し、対象テストは変更前に失敗、修正後5/5成功。生成bundle hashは `B6ED3DD5BF5FB6425543FD2E628AE4DEB793D66B6E4D244493A380CFFFEFA7D9`。これはローカル候補で、Apps Scriptには未保存。現行live handlerはpaused時にcleanup前でreturnするため、自動TTLはまだ実証されていない。CSVは既に手動ゴミ箱移動済みなので、実証できるのは期限切れ台帳のcleanup実行まで。20:51 JSTに更新を試みたが、ブラウザのファイルURL制限でローカル候補を渡せなかった。誤った転送経路は試さず、復旧したqueue 1分/sync 5分の2 triggerを維持している。
- Fのrelease manifestはP/F/Cの28ファイルhashとlive状態を記録し、19:43時点の実トリガー・paused状態・公開済みルールを反映した。再生成後はlive欄が初期化されるため、実測を取り直す必要がある。Apps Scriptへの今回の候補保存、push/rollback dry-run、Pages公開・公開URLの実ブラウザ確認は未完了。
- 旧form移行と公開環境での再受入も未完了。全体pending上限、Cloud LoggingのPII監査、終日quotaと待ち時間、Blaze予算監視判断を閉じるまで受付再開・広範囲切替え・公開は保留する。

**2026-10-15 追加検証:** Pの `npm run build`、`npm run test:history`（24件）、`npm run test:browser` は成功。初回の `portal-focus-smoke` はタイムアウトしたが、単独再実行と4本のブラウザsuite再実行はChromium/WebKitで成功し、保存領域拒否時に企画一覧がエラー表示へ切り替わることも直接再現した。Fはworker suite 48件、recovery suite、RTDB rules 4件、Carbon React契約、Apps Script候補build、390/1280pxブラウザ検証が成功。Carbon Sassの非推奨警告のみ残る。Carbon契約で見つかった `.claspignore` の明示的な除外不足を直し、契約テストを再実行して成功した。Fのローカルmanifestは28ファイルのSHA-256を再取得した。これは公開物との一致を示すものではない。

同日19:06 JSTの受入前チェック時点では、専用Apps Scriptのアカウント・Script IDと保存済み2ファイル、Firebase受付停止、`dailyCount:0` を確認。新規フォーム作成・回答送信・Drive出力・Pages公開はその時点では未実施だった。その後の19:18 JST追記に合成受入の結果を記録した。

**2026-10-15 19:18 JST 合成受入追記:** 正しいサイドブラウザの `sanpokai.formmaker@gmail.com` / 専用Script ID `1Z_fpG_nd4UazqRZKbZHhzlcTsD0jBEaUXIqCXmqNTmgg5edgLNljgx50` で、保存済み `コード.gs` がローカル候補と改行コード正規化後に一致することを確認。専用Firebaseキューは実行前に空で、受付停止だった。合成フォーム「テスト専用 連携確認 20261015」を1件だけ作成し、合成回答「連携テスト太郎」を送信。初回同期で `FORM_IMPORT_BATCH_LIMIT` 未定義が発覚した。原因はworker bundle生成時の定数選択漏れで、`tools/build-worker-source.mjs` に定数を追加し、bundle実行テストで失敗→修正後成功、worker suite 49/49成功を確認。修正版Code.gsを同じScript IDへ保存し、受付を一時有効化して同期を再実行した。

Firebase `rooms/P1C34AE0E8277438BBAE/meta/applicationSync` に `kind=formApplicationSync`, `version=2`, `responseCount=1` が記録され、Circle企画画面で「応募者1人 / 連携テスト太郎」を確認。架空応募者だけを企画の参加者に確定した。Apps Script受付は再び `accepting:false`, `state=paused`, `dailyCount=1`。Drive CSV作成・編集者ACL・TTL削除はアクション時の個別承認を待っており、公開・Pages反映は未実施。

**2026-10-15 19:35 JST Drive合成出力追記:** 承認された企画 `P1C34AE0E8277438BBAE` から、候補版のローカルReact画面と専用workerを使って架空参加者1人だけの `テスト専用 連携確認 20261015_参加者.csv` を生成した（Drive file ID `1586vaby_WcSd3fXorJgL6suZYOrFlMVn`）。Driveプレビューでヘッダーと合成1行だけを確認。共有設定は所有者 `sanpokai.formmaker@gmail.com` と編集者 `610unko@gmail.com`、一般アクセスは「制限付き」。画面には「24時間後に削除」と表示された。検証後、ユーザー承認どおりこのCSVだけをゴミ箱へ移し、オーナーDriveのゴミ箱で同ファイルを照合した。他のファイルは操作していない。Apps Script workerは `accepting:false`, `state=paused`, `dailyCount=2`, `dailyLimit=40`, `errorCode=""` をFirebaseコンソールで再確認。実際の24時間経過後の自動削除と、201件拒否等の実環境試験は未実施。公開・Pages反映も未実施。

**課金状態の確認:** 2026-10-15 18:56 JSTにChromeのFirebase使用量・請求画面を確認。`sanpokai-tool` はBlaze、当月表示額 `$0.00`、Realtime Databaseは123.3 MB/1 GB、ダウンロード3.8 MB/360 MB/日。Blazeでは無料利用枠を超えると請求されるため、Sparkと同じ「超過時に課金されない」前提では扱わない。予算アラートの有無と既存Apps Script全体の90分/日の利用量は未確認。Firebaseの最新請求説明とApps Script割当は[Firebase billing](https://firebase.google.com/docs/database/usage/billing)および[Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)を参照。

**2026-10-15 21:01 JST 追加再開記録:** 保存前のローカル監査で共有失敗例外をログへ渡す3箇所を発見（フォーム/Drive共有2箇所、回答スプレッドシート共有1箇所）。元ソース `コード.js` と `auto-sync.js` のログから例外オブジェクトを除き、メールアドレス等を含む例外本文をCloud Loggingへ送らないよう変更した。テストは修正前に失敗、修正後成功。worker suiteは51/51成功。これはコード静的レビューとローカル試験であり、既存Cloud Logging履歴のPII監査を代替しない。候補bundle SHA-256は `AE638C8FD8FE3F8BCCA0EBD2D9C92B26EBD35DA299D65D80B856F4A1B5FF981A`。pending jobの安全な全体Admission capは、今のRTDB直接書込み契約ではサーバー側の原子的な共通枠がないため未解決として維持し、公開前に別の安全な予約設計が必要。正しいサイドブラウザの実行一覧でqueue 1分は20:51:53・20:54:32に成功、sync 5分も20:54:32に成功。受付は停止中。ローカルApps Script bundleのブラウザ転送はURL安全制御で拒否されたため、迂回は行わず、リモートソース保存・cleanupの実行証拠・rollback dry-run・本番公開・実ブラウザ受入は引き続き未完了。
- Screenshotの誤ったApps Script ID `Mabut0p2i5NY6AxsooZY22P9-mCOf3Byv` は専用workerではない。正しいプロジェクトは `1Z_fpG_nd4UazqRZKbZHhzlcTsD0jBEaUXIqCXmqNTmgg5edgLNljgx50`。現在のサイドブラウザに正しいプロジェクトの実行一覧が既にある。

**2026-10-15 21:05 JST 保存確認追記:** ユーザーがローカル候補を正しい専用Apps Scriptプロジェクトへ貼り付けて保存した。プロジェクト履歴に21:01 JSTの現在の版が表示された。保存後のqueue実行（21:01:53、21:02:53、21:03:53）とapplication sync（21:04:32）は成功。Firebase worker状態は20:59:59 JSTの観測で受付停止（accepting=false、state=paused、dailyCount=2、dailyLimit=40、errorCode空）。保存した完全なCode.gsをUIから独立して抽出できず、ローカル候補とのbyte-for-byte一致は未確認。定期処理の成功だけでは期限切れ台帳の自動cleanup完了を証明しない。全日quota、pending admission cap、Cloud Logging履歴監査、24時間cleanup実証、rollback dry-run、Pages公開・公開ブラウザ受入は引き続き未完了。

**2026-10-16 05:52 JST 再開確認:** ChromeのFirebase Console（`610unko@gmail.com`）で受付は `accepting:false`, `state=paused`, `dailyCount:0`, `dailyLimit:40`, `errorCode`空、最終更新05:50:55を確認。サイドブラウザのApps Scriptは `sanpokai.formmaker@gmail.com`。専用workerはqueue 05:50:53（2.38秒）と応募同期05:49:32（0.836秒）が完了。旧同期 `syncManagedFormImports` は1分間隔で動作し、05:50:42（29.168秒）、05:49:42（14.342秒）は再読み込み後に完了表示となった。公開URLは旧iframeの「現在、ファイルを開くことができません」と履歴連携待ちを表示し、Pの新画面は未公開。短い成功履歴は24時間quota測定を解決しないため、受付停止を維持し、旧同期・本番ルール・Apps Scriptソース・Pagesを変更しない。
