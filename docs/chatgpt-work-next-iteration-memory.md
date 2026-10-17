# ChatGPT Work 引継ぎ：Google Maps・Yahoo!乗換案内とMyMapの操作差

更新: 2026-10-17。対象 `at5tram98-hash/kyoto-transit`、本番 https://at5tram98-hash.github.io/kyoto-transit/ 。最初にmainを取得し、その時点のコード・公開build・テストを再確認する。古い検証結果を現在の動作の証拠としない。

## 最新改修（2026-10-17）

今回build **`fa429f63131d`**、開始main `dfd4352`。公開とCIの確定情報は [最新の実装・公開記録](spec-completion-2026-10-16.md) を正とする。旧版の未実装リストをこの版へ転用しない。

- 運行の関連→保存→全路線。既存settings.favoriteOperationsが唯一の保存先。明示的で新鮮な運休/遅延だけ自動回避に使い、古い/未確認の公式お知らせを運休と捏造しない。既存plannerのoperatorsを使用し、throughは両社許可が必要。運行からの回避検索は実際の候補まで進み、選択まで現在Journeyを破壊しない。
- `journey-recovery.js`は明示的な途中降車、未完了経由、現在の運行日/時刻/既知の到着と余裕を使う。時刻だけの自動乗車は禁止。全旅程の将来便も既存snapshot最大5件・別便Sheet/再計算で変更。完了/乗車中区間は固定、revision/変更降車先/過去便を適用前にも確認する。
- Search入力は既存モデルが所有する。root:searchの`ownsFields:true`を削除すると、Historyの古いDOM値が新しい回避条件を上書きする。Navigationは引き続きscroll・focus・detailsを所有する。履歴detailsには安定idを使う。別のStateを増やさない。
- `locale-ui-ja/en.js`の846項目、`locale.js`、公式駅English名の単一所有`station-names.js`。操作ラベルと画面HTMLを分離し、action属性・placeholder・データIDは両言語同一。日本語の公式固有名/外部原文は未翻訳。localeは既存settingsに保存し、変更reload後も旅程・保存運行を保持する。
- CSSのradius/shadow/colorはroot tokenを唯一のownerとし、gestureのbackdrop進捗は動的変数のまま。200%時は設定controlを縦に、Nav titleをBackの下に配置。英語TabはTimes。Quick Selectの任意低速移動は既存tickとnative scrollで、操作/Reduce Motion/非表示で停止する。
- 未達: 京都バスODPTの本番health=false。環境候補keyの公式応答は403 Invalid acl:consumerKey.。無効値をWorkerに設定しない。実機/実走も未実施であり、全78節のoverall100Percent=false / Global Release Ready=falseを維持する。Safariの触覚はWeb API対応が前提。

## 前回公開記録（2026-10-16）

frontend build **`06ad19dcadc7`** は本番公開済み。UI source `2659964` / merge `0a99bf8`、API修正 source `6248187` / merge `f26fb06`。Pages [38837839758](https://github.com/at5tram98-hash/kyoto-transit/actions/runs/38837839758) とWorker [38840924385](https://github.com/at5tram98-hash/kyoto-transit/actions/runs/38840924385) はSUCCESS。

公開後に見つかったCache APIのimmutable HeadersへのCORS追加による500は、既存`finalize`のResponse再構成で修正済み。`tests/worker-cached-response.test.js`の200/304回帰2件を含む363モデル成功。cache応答を直接変更する実装に戻さない。実API連続200×3とETag304、必須公開9項目が02:35:20 UTCに成功。backend修正に`public/`変更はなく、重複Pages run 38840924434はcancelledであり成功とは数えない。

公開HTTPSでfixtureなしに当日丸太町→京都を検索、11:27発から11:42発へ変更、案内準備・reload保持・全旅程・Back・解除を確認。実際の旧PWA `0e633053b133`→`06ad19dcadc7`更新でも選択tripIdと全旅程を保持した。[公開記録・原本JSON](evidence/native-2026-10-15/production-release.json) / [報告](native-final-implementation-2026-10-15.md#本番公開結果2026-10-16) / [実公開8画像](evidence/native-2026-10-15/README.md#本番公開後の実画面2026-10-16)。Global Release Readyは引き続きNO。公開済みであることを実機・実走合格と混同しない。

## 前版の設計記録：iOS純正アプリ級 最終仕様（2026-10-15）

今回のユーザー0–77節を最優先する。実装・新Navigation Map・Main/Push/Sheet/Fullscreenの配置・操作数・実機試験表・残存制限は [最終仕様の実装対応表](native-final-implementation-2026-10-15.md) に記録する。以前の「今もYahooと同じ検索画面」は今回のLive専用構成へ置換された。競合の優れた操作原則を使い、ブランド固有画像はコピーしない。

- 5 Tabは **Live / 検索 / 時刻表 / 運行 / その他**。既存Navigation Stack / History / Swipe / cacheを維持。旧 `route-search-home.js` は削除し、`live-home.js` が専用Liveを所有する。検索フォーム・結果・旅程Storeは一つ。
- Live未乗車はMyMap/Live、Capsule、秒時計、Quick Select長押し、現在地、交通地点検索、Mini Map、近く・方面・接近。Rideは次駅・降車を優先し、詳細はPush。MapはPan/Pinch対応の補助サイズ、外部ActionからFullscreen。
- `transit-evidence.js` はSource別期限付きEventと循環・方向trailを持つ。同じGPSの反復を複数票に数えず、時刻表/旅程だけ、GPS/Motionだけの歩行、曖昧な方向では確定しない。地下・停車中候補を保持し、確定rideの弱いGPSによるflipを防ぐ。再検証せずthresholdを緩めない。
- `announcement-parser.js` で構造化。既にgrantedと確認できるマイクだけ、最大6秒。自動判定/音声補助OFF・非表示・離脱で停止する。権限promptや常時録音を追加しない。
- 検索はfirst/last、交通機関、徒歩速度を既存routerと別便再計算へ渡す。近鉄条件は利用可能な検索だけ。日時fit Sheet、主要「案内を開始」は下部、画像保存はその他Sheet。WebKitではSheetのHistory dismiss完了を待ってdownloadする。
- 折り返しは既存指定駅/指定列車と「次駅」の3方式。既存の時刻表・遅れ・ホーム移動・余裕計算を共有し、未取得時間を生成しない。指定列車の共通駅は `foldback-meetings.js`。
- 新旧色の混在を戻さない。烏丸線=緑、近鉄=赤橙、市バス=橙、京都バス=青、実測=緑、予測=橙、予定=灰、遅延=赤。新規/変更部はsemantic token、content solid / control glass。旧CSS全体のtoken移行が100%済みとはしない。
- Offline/古い運行はUnknown。検索snapshotのsourceも観測から90秒・onlineを検証し、ラベルのみ更新して経路DOMを保持。Workerはpagehide/beforeunloadでabortし、復帰は再試行導線。自動テストのpageerrorを一括除外しない。
- Global Release Readyは **NO**。物理iPhone/実走・音声認識精度・OS Edge/VoiceOverは未実施。英訳は基盤とLive主要辞書のみ。運行の自動回避・運行路線お気に入り・旅程変更後の自動再計画は残課題。自動CI成功を実走・仕様全体100%と同一視しない。

提出対象buildは `06ad19dcadc7`、開始/再確認mainは `8f04791`。モデル361、WebKit/Chromium各596、PWA各9、34画面272状態（44px/8px/衝突・文字切れ0）が成功。証拠は最新レポートと `docs/evidence/native-2026-10-15/`。この段落は公開前のローカルBrowser結果。公開は上の最新記録を参照し、物理iPhone試験は未実施。次回はその時点のmain/公開buildで再確認する。

## 以前の基準と引き続き維持する制約

- 以前の基準は `docs/reference/mymap-v3-redesign-2026-10-14.txt`。5タブ・情報設計変更・短い別便Sheetを継承する。今回と矛盾するHome/CTA配置は上記の最新仕様を優先する。
- 以前のユーザー提供資料は `docs/reference/mymap-34-screen-brief-2026-10-14.txt`。資料中の100%という評価、CI成功、競合操作の記述は提供された情報であり、現在のMyMapや競合実機の実測結果として転用しない。
- 添付資料全体の対応表は `docs/brief-acceptance-2026-10-14.md`。最新の改修と検証は `docs/journey-upgrade-2026-10-14.md`。既存34画面の比較は `docs/ui-ux-screen-comparison-2026-10-13.md`、公式参照元は `docs/transit-comparison-2026-10-13.md`。
- PDF `MyMap_UI_Design_Spec_2026_Updated.pdf`、WORK HANDOFF v1.1、`docs/design-spec-v1.1-2026-10-12.md`、`docs/navigation-architecture-2026-10-13.md`、Visual Difference Matrixも基準にする。
- iOSの階層と既存交通機能を維持する。地図をホームの主役にしない。機能を削除しない。CSS末尾で大量上書きしない。巨大なdocument click router、別のダミー探索・Navigationを作らない。許可済みの作業でプラグイン確認を繰り返さない。
- 烏丸線・近鉄・直通・K/B境界、北3・全既存バス／停留所、次駅Hero、降車、前方／反対方向列車、Realtime、遅延、全駅時刻表、折返し、運行・接近、運賃／定期、地図、GPS、通知、Dark Mode、Dynamic Type、Reduce Motion、設定を維持する。

## 競合について確認できた差

Google MapsのiPhone向け公式ヘルプは、出発駅付近の後発時刻、他の出発情報、選便後の現在・後続交通機関の時刻更新を説明している。Yahoo!の公式紹介画面では早・楽・安、一本前／後、発着・ホーム・途中駅・乗車位置などが見られる。これらの公式資料と競合の実機タップ座標・モーション・ジェスチャーを区別する。競合アプリを実機で完全操作したとは報告しない。

- https://support.google.com/maps/answer/6142130?hl=ja&co=GENIE.Platform%3DiOS
- https://support.google.com/maps/answer/144339?hl=ja&co=GENIE.Platform%3DiOS
- https://transit.yahoo.co.jp/promo/app/
- https://transit.yahoo.co.jp/

MyMapは交通中心の5タブ（Live・検索・時刻表・運行・その他）と独立Stackを持つ。Googleの地図中心ホームをコピーする必要はない。便選択・接続再計算・状態保持・情報の優先順位を取り入れる。

## 2026-10-14に実装済みのもの

1. 経路詳細の各「発車時刻」→短い別便Sheet→選択→後続旅程を再計算・確定→同じ経路詳細。その他の便から既存の全便比較Push・プレビュー・取消も利用できる。発車表示だけを差し替えず、後続乗車・徒歩・滞在・buffer・到着・全区間運賃・定期・案内対象tripIdを既存router/faresで再計算する。
2. 連続するJourney Rail。左が時刻、中央が線／ノード、右が駅・停留所・路線・行先・取得済み番線。到着、徒歩、乗換待ち、次の出発が追える。途中停車の開閉、共有、保存、案内開始を保持する。
3. 「1本前」と「次の出発」の全経路検索。各Legの便選択とは別操作。出発条件と後続接続を探索し、一律の時刻引算ではない。
4. 接近情報の第一階層は系統・行先・到着／分／停留所前、第二はのりば・混雑・遅れ、第三は実測／予測／予定と各行の更新時刻。系統・方面別の全行、位置図、1停留所前の点滅とReduce Motionを維持する。
5. 市バス停留所詳細に系統chip、確認できる接近2〜3件、全接近への導線。停留所数だけのデータから分数を生成しない。京都バスの実測未取得は明示し公式時刻表を案内する。
6. 全旅程を案内準備・乗車・降車後の乗換・次便・最後の徒歩へ保持する。「次の行動」の行から全旅程へPush。次便は準備状態とし、実乗車は明示操作または既存の検証済み乗車判定に従う。時刻だけで自動乗車させない。
7. 乗車・検索経路の運行情報を先に並べ、その他事業者も残す。経由と滞在の説明、通過済み表示、定期適用表示、距離設定の現在地からの実駅数、出典・更新・推定の説明を追加する。

8. 保存した経路の実在する駅・停留所から時刻表へ直接進むショートカットがある。結果はstatusだけの更新で再描画せず、pointer/keyboard操作中の表示変更を待ってtapを保持する。timer/listenerはscreen disposeで解放する。

再実装や新規機能扱いで重ねないこと。

## モデル・所有・状態保存

- `journey-plan.js`: 候補・再計算・全旅程・保存。`serviceId + tripId + serviceDate + from + to`を便識別に使い、Screen revision / routeVersionで古い非同期結果を拒否する。
- `route-trip-screen.js`: 選択・プレビュー・取消の専用Controller。元経路を変更するのは確定時だけ。スクリーン・選択draftのcacheは有限。
- `router.js`: 再探索のseedで前区間、累積徒歩、乗換、経由滞在を引き継ぐ。`search-core.js`: feed統合、前便探索、Realtime照合。`planner-worker.js`: 既存Workerで実行。
- 検索日は絶対分の基準日、元の運行日はserviceDate。翌日feedは1440分を加え、24:xxや同一tripIdの別日を混同しない。実乗車モデルは元運行日の時計に戻す。定期期限は区間の実乗車日で判定する。
- 同区間・同事業者・同バス系統・停車順・急行通過・経由滞在・運行variant・接続余裕を検証する。表示候補は前後6時間、最大60件。必要な翌日feedを追加する。検索条件外の全サービスを別UIで黙って混ぜない。
- 便・運行日一致かつ90秒以内の実測のみ、対象tripの時刻を反映して後続接続を再探索する。同じ路線・行先だけの照合は推定。予定を維持し見込みと乗換危険を表示する。複数候補なら決めつけない。接続がない全経路の確定を拒否する。
- Browser clockとWorker clockが別になるテストでは、ページのnowEpochをpayloadへ渡す。fresh判定を弱めてテストを通さない。
- `route-search-ui.js`のsnapshotは5検索、feed contextは3件。既存Navigationは最大5 Screen。古いHistoryへBackしてもsequenceの上限を維持し、別の新Pushへ同じ画面keyを再利用しない。
- 戻る時の経路・途中駅開閉・scroll・Tab・選択draftを保持する。Reloadした便選択は保存snapshotを復元して再計算する。
- `mymap-itinerary-v1`は全Legと公式乗車モデルを4時間まで保持し、サイズ・時刻・停留所・配列を検証する。既存の現在乗車・折返し保存を残す。GPS履歴を保存しない。明示終了／取消で全旅程も消し、Reloadで復活させない。
- `bus-stop-preview.js`は表示中の停留所画面だけpollする。非表示でabort/停止。共通Realtime cache/fetch/20秒loopを利用し、接近画面の選択停留所を勝手に変更しない。
- main `6dbe536`のKV quota対策 (`worker/entry.js`, `kv-safe-env.js`, wrangler entrypoint) は保持済み。フロント改修に紛れて元のentrypointへ戻さない。

## 次に追加実測・整備すること

- iPhone実機のSafari／StandaloneでOS Edge Back、キーボード、VoiceOver、Hapticを検証する。WebKit/Chromiumの自動操作と実機確認を混同しない。
- 乗車後に将来Legの便を直接編集する操作、接続を逃した時の全旅程の再提案は次段階。現在は次便表示・接続危険の警告・手動の検索が可能。降車地点を変えると元の後続への進行を拒否するガードは実装済み。変更先からの自動再計算は未実装。
- 初期検索が深夜に翌日サービスへ接続するcoverageを増やす。今回の翌日取得は主に便選択時。2日を越す長距離・全国検索は対応済みと主張しない。
- 番線・乗車位置・入口／出口・POI・住所・運休回避・施設の段差・車椅子経路・網羅的な始発／終電はデータ整備が必要。取得していないものをUIだけで追加しない。
- 京都バスODPTはoptional未設定。市バス・近鉄の便別tripId/運行日・位置照合のcoverageを計測する。APIの欠測率、取得時間、方面別coverageを継続計測し、1回のproduction成功を常時安定と解釈しない。
- 市バスの4秒timeout、20秒更新、全方面fallback、予測source、quota-safeなKV書込みを維持する。古いcacheを実測と表示しない。

## 必須検証

Node22環境で `npm run check`、`npm test`、`npm run build`、`npm run test:browser`、`npm run test:pwa`。`BROWSER_UI_AUDIT=1 npm run test:browser`は34画面の拡張座標検査。`BROWSER_JOURNEY_ONLY=1`は選便・接続・全旅程・地点接近の新フロー。

390×844 Light/Dark、文字100/150/200%、Reduce Motion、GPS ON/OFF、805px、320px、44px以上のtarget、独立action間隔8px以上、CTA hit、App/Browser/Swipe Back、scroll/Tab/reload、実タイルを確認する。競合とMyMapのSource、情報量、操作を画面別に比較し、Before/After・座標JSON・選択した実tripId・通ったテスト・公開build・残存課題を報告する。検証結果は今回の改修レポートを参照し、再作業時に取り直す。


## 以前の公開版の検証（v3改修前）

main実装 `5b1b57f3`、公開build `af4813c8cc67`。Pages CI 38513683449 SUCCESS、Worker CI 38500581938 SUCCESS。333モデル、WebKit/Chromium各458、PWA各9、実地理210。ローカル拡張34画面272状態はtarget最小44px、独立action最小8px、clipping/collision0。

本番をbuild固定で実接続検証し、2026-10-14T05:13:18.954Zに必須9項目passed。京都バスODPTだけoptional未設定。さらに実公開WebでAPI/時計/GPS/tileのfixtureなしに当日ダイヤ検索・14:19→14:27別便・確定・全旅程準備・Back/取消を操作し例外0。現在の成功を将来の常時安定と取り違えない。

CIで確認したフォント差のチェックmarkは固定SVGで解消済み。status-only更新はcardを保持する。実際に内容が変わってもpointer/click delivery/keyboard focus中は描画を待ち、screen hide/disposeでtimer/listenerを清掃する。新しい回帰試験でこの操作競合を維持すること。

## v3所有・状態・操作の追加ルール

- Search Tab Rootの単一フォームを固定所有する。NowやTimetableへDOMを移動しない。日時／条件は `form=planner-form` の外部コントロール。最近・保存・近く・全停留所・既知の施設はFullscreen候補のControllerが所有する。一般住所／POI検索を実装済みと誤認しない。
- `idle-experience.js` のMutationObserverによる後付けは削除済み。交通アイコンと近隣次便は `vnext-view.js` が直接表示し、`updateNearbyPanel` のkeyでボタンをGPS更新から保護する。
- `route-trip-screen.js` は短いSheetと全便比較を一つの選択・計算pipelineで扱う。`planner-worker.js` は選択便と後続をfreshなexact observationで再探索する。`journey-session.selectedRideShift` は便・運行日・serviceId一致かつ90秒以内の実測だけを乗車案内に引き継ぎ、公式時刻へ二重加算しない。
- `saved-places.js` は登録地点IDのみ最大50件。既存の保存経路Storeと別用途。GPS履歴や同じ検索設定の複製Storeを作らない。
- `arrival-schedule.js` は同日・系統・方面／行先一致の取得済み公式便だけを予定fallbackに使う。未取得・曖昧な方面は時刻を生成しない。市バス／京都バスの同名停留所を同一Realtimeとして扱わない。
- 1本前後による同深さの結果更新はHistory replace、深いsingletonへの更新は該当entryまで巻き戻してreplace。Browser/App/Swipe Backの親を一致させる。Tabの検索入力・並び順・map・scroll・focusを保持する。Nowのride/journey identityが変わった時だけ主要情報へ戻す。
- Sheetはfit/medium/large detent・1:1ドラッグ・velocity・scrollTop競合を共通Controllerに持つ。close時に残存Animationをcancel。visualViewportのresize/scrollでキーボード上端・高さを更新。
- Transport／Statusの色は `vnext.css` のLight/Dark semantic tokenだけを使う。実測の緑と遅延の赤は独立。運行未取得はUnknown。ホーム地図を主役にしない。
- 最新のテスト数・build・公開CIはv3レポートを参照。以前の旧版の成功数を新しい版の証拠として転用しない。実機SafariのOSジェスチャー・VoiceOver・Hapticは別途実測が必要。


## 以前の実装記録：Yahoo画面整合（今回のLive仕様でHome/CTAを置換）

当時の「今の画面」「経路が出る画面」をYahoo!乗換案内へ寄せる指示の記録。以下のHome/CTA/旧moduleは今回のLive設計で置換済み。詳細は `docs/yahoo-screen-alignment-2026-10-15.md`。公式2026/09/15更新画像の新Home/detailを優先。競合実機を操作・測定したと誤認しない。MyMapブランドと実データだけを使う。

- Now未乗車は出発／経由・現在地・入替／到着／日時／条件／橙色検索。最寄りはHome内の同列切替、定期券は既存設定。Homeで直接候補画面を開いて今Stackへ結果→詳細をPush。
- `route-search-home.js` は既存検索Controllerの入口Viewだけ。canonical `#planner-form` はSearch Tabに一つ、入力・検索結果・via・保存Store・Sheetを二重化しない。
- 番号付き結果行、中央日時（tapで変更・取消可）、左右1本前後、早・楽・安。発着の行をtapして条件編集。詳細は5操作→駅帯／時刻／路線。発時刻は既存の別便Sheet・全便比較を開き、便ID・後続・運賃を再計算する。
- 詳細の案内準備CTAは上部操作列の `[data-arm-route]`。旧 `.screen-bottom-action`、共有の旧Navigation Toolbar selectorは使わない。`route-image.js` は選択経路の実モデルからPNGを生成する。OSスクリーンショットではない。
- クリックは `closest` でbuttonまで特定する。`now-navigation.js` はNow内部の `button[data-navigation-screen]` のみを扱い、祖先app-shellのscreen属性を拾わない。装飾span/iconを押しても結果のsortを行う。
- 古い `stability.css` の小画面card半径・padding例外を削除済み。owner CSSの責務を戻す。44px／8px／文字切れの検査を維持する。
- YahooのIC残高、指定席、乗車位置・出口、独自運行Pushなど取得していないものは偽装しない。物理iPhone、Yahoo実機との完全ピクセル一致・全機能同等は未確認。乗車Hero等の既存交通機能は継続。最終build／CI／残差は最新レポートを参照する。

Homeの送信前の候補確定、日時／条件Sheetのcloseでもcanonical inputをNavigation memoryへ保存する。Search Tabのcaptureだけに頼ると、Nowで選んだ未送信の入力がreloadで消える。候補選択→未送信reloadの回帰を維持する。ブラウザーテストの接近・近隣はHomeの「最寄駅検索」を実際に押して開く。非表示の旧配置をforce clickせず、44px／8pxの基準も維持する。

`fast-data.installFastData` の先読み予約はbeforeunload後、まだdocumentがvisibleでも実行してはいけない。idle/timeoutのhandleを保持して離脱・非表示でcancel、未実行分だけ復帰で再予約する。WebKitで折返し復元を続けてreloadすると古いdocumentが4通信を始めCORS例外を出していた。テストのCORS/pageerror検査を弱めず、この実操作の回帰を維持する。fixtureのfetchやURLをtimestamp付きへ差し替える試みは最終版から撤回した。


## 今回の改修前の公開記録（2026-10-15）

実装source `fea1e58`、公開build `0e633053b133`。Pages CI 38669787095 SUCCESS：モデル340、WebKit/Chromium各586、PWA各9、実地理210、必須公開9項目成功。公開実ブラウザーでもfixtureなしで当日丸太町→京都、11:42→11:49発の別便変更、案内準備・全旅程・Back・解除、例外0。最新の証拠・Before/After・残差は `docs/yahoo-screen-alignment-2026-10-15.md` を参照。Yahoo実機との完全一致や物理iPhoneの認証を意味しない。京都バスODPTキーはoptional未設定で公式時刻表を利用。

この後のdocs/evidence記録追加はruntimeを変更しない。次回は必ずその時点のmain／公開buildを確認し直す。
