# MyMap 最終仕様・実装対応表（2026-10-15）

検証完了日: 2026-10-16。対象build: **`06ad19dcadc7`**。

基準: ユーザーの「MyMap iOS純正アプリ級 全面構築・最終実装仕様書」0–77節。開始時main `8f04791`、runtime `fea1e58`、build `0e633053b133`。今回のLive専用設計を、以前のYahoo同画面指示より優先する。競合ブランドの画像・ロゴは製品へ転用しない。

## 実装前の構造と移行

既存: 5つの独立Navigation Stack、History連携・左端1:1 Pop・5 Screen cache・scroll/focus保存。Now未乗車は検索フォームの入口View、実フォームは検索Tabに一つ。乗車時はHeroと主要Action、詳細はPush。GPS freshかつ2.8m/sが自動判定の入口条件。マイクは許可済みだけだが文字包含による候補クリックで確定する。

新Navigation Map:

- Live（NowStack）: LiveHome / RailRide / BusRide → 停車駅 → 駅詳細、列車位置、遅延、接近、運行、地図。
- 検索: RouteSearch → SearchResults → JourneyDetail → 別便 → 再計算 → JourneyDetail → 案内準備 → Live。
- 時刻表: Home（検索・保存・近く・路線）→ 路線 → 駅・停留所 → 全便詳細。
- 運行: 現在の移動・関係路線・全路線 → 運行詳細 → 条件を見直して再検索。運行路線お気に入りは未実装。
- その他: 保存 / 交通 / アプリ / 状態 → 個別設定・Privacy・利用条件。

|機能|配置|既存の所有と変更対象|
|---|---|---|
|時計・Quick Select・現在地・交通地点検索・Mini Map・付近の交通|Live Main|route-search-home.jsを廃止してlive-home.jsに置換。検索Stateは複製しない|
|乗車次駅・残数・簡易駅列・重要警告|Ride Main|vnext-view / now-model / now-componentsを保持|
|停車駅・駅詳細・列車位置・遅延・運行・検索結果・経路詳細・全時刻表|Push|navigation / now-navigation / timetable-ui / route-search-ui|
|交通地点詳細・Quick Select選択・降車・日時・フィルター・別便|Sheet|context-sheetの共通gesture / fit・medium・large|
|詳細地図・候補入力|Full Screen|route-map / stop-autocomplete、地図のviewportは戻っても維持|
|折り返し3方式|短い選択Sheet＋既存計算結果|vnext-foldback / boarding / journey-core|

## Motion / State / History

Push/Pop/Tab/Sheet/Heroは既存navigation-motionを共通所有。Mapは指追従のpan/pinch、独自scroll physicsは導入しない。Quick Select長押しはpointer追従、長押し認識・目的地確定時にHaptic。非表示・pointercancelで中止する。

検索は単一フォームとsnapshot、保存場所はsaved-places、Journeyはjourney-plan/sessionが所有。新たな重複Storeは禁止。Live時計の形式は既存settings、Quick Selectは保存場所を参照。Evidenceは短いメモリ上の期限付き履歴のみでGPS/音声を永続化しない。

GitHub Pages/PWA互換の既存hash URL `#/now` / `#/now/stops` / `#/search/results`等を継続。App Back / Browser Back / Swipe Backは同一controllerをPopする。Tab名Liveへの変更でURL互換は維持。

## 対応・検証表

|仕様|実装・検証対象|開始時の差|
|---|---|---|
|0–8, 54, 57–58|意味色token・solid/glass・SVG・文字・共通motion・a11y・locale基盤|市バス/京都バス色とLive見出しが不一致|
|9–23|5 Tab / Live header・clock・quick・場所検索・pan/pinch Mini Map・方面/接近・Ride|未乗車が検索と同じ入口、Mini MapとQuick不足|
|24–34|TransitEvidenceEngine、独立source consensus、地下保持、順方向trail、循環、hysteresis、構造化音声、短時間停止|fresh GPS/speed gate・同一source連続fix・音声から直接click|
|35–45|出発/経由/到着、日時fit、交通/徒歩/近鉄条件、始発終電、結果前後便/早楽安、timeline、全再計算、主要CTA|条件不足・列車条件常時表示・主CTAの優先度|
|46–50|既存時刻表/運行/その他を維持、現Journey再検索・Privacy/権限/表示|Privacy/状態の入口不足|
|51–56|既存2方式を維持し次駅方式を追加、共通Sheetのfitとgesture、長押し/Haptic|fit/長押し不足|
|59–67|Privacy・Offline・stale・loading・差分・race・PWA・復帰再同期|Audioの最大時間/停止・新engineの復帰同期|
|68–73|390 Light/Dark/100–200/HC/Reduce、WebKit/Chromium、座標、Map/PWA、実走表とRelease Gate|物理iPhone/実走はクラウドから実施不可|
|74–77|機能保持、重複削除、Before/After・操作数・検証証拠・残差|新仕様の達成をCIだけで断言しない|

## Before

最新mainからbuildし、`BROWSER_UI_AUDIT=1`で34画面×8状態（272）を取得・座標検査済み。保存先 `/workspace/artifacts/mymap-final-spec-2026-10-15/before`。Afterと同じfixtureの時刻・GPS・便を用い、実データ試験とは区別する。

## Release Gate

物理iPhone Safari/Standalone、VoiceOver/Haptic/OS Edge、実路線の北行/南行/循環/逆方向は未実施。60秒以内・方向誤検知0は目標であり実測値ではない。Global Release Readyは実走とP0を確認するまで **未判定 / NO**。クラウドの自動テスト成功を実走成功に置き換えない。


## 実装したUX

Liveは出発・到着フォームから独立した移動ホームになった。MyMap / Liveと3操作Capsule、秒時計と12/24時間切替、Quick Select、現在地の取得・低精度状態、交通地点だけの検索、180pxの地理Mini Map、付近の交通・方面選択を表示する。保存場所をQuick Selectに使い、その他→保存した場所からSVGアイコンを変更できる。長押しは元の目的地列を指で選択し、離すと同じ検索Controllerへ渡す。一般施設検索とLiveの交通地点検索を混ぜない。

乗車時はコンパクトなNavigationに切り替え、次駅と降車地点を文字200%でも優先する。烏丸線・近鉄・竹田のK/B境界・直通・市バス・京都バス・北3、途中時刻、前方/反対方向列車、通知、運行、地図等の既存モデルと導線を維持する。詳細のPushと短い選択のSheet、地図Fullscreenという既存階層を再利用する。

Mini Mapは実際のMercator投影・OSM PNGタイル・登録位置・既存路線形状を使う。PanとPinchを指に追従させ、fractional zoomは整数タイルを拡縮して描く。現在地DotとAccuracy Circleを差分更新する。低精度GPSを取得失敗と混同せず、位置未取得時の京都中心部は現在地と明確に区別する。利用者が動かしたviewportは更新やBackで保持する。Map内のボタンは外に出し、地点tapで短い詳細Sheetを開く。

検索は単一フォーム、Worker探索、便選択・後続再計算・運賃/定期・履歴・保存・共有を継続。日時Sheetはfit、取消でdraftを戻す。始発/終電では無関係な時刻欄を出さず、見出しも始発/終電だけにする。利用交通機関と徒歩速度を実際の接続/徒歩上限/別便再計算へ渡す。近鉄を使う条件のときだけ列車種別を表示する。詳細の主要操作は「案内を開始」、画像保存はその他へ移す。未取得の番線・所要時間・運賃を生成しない。

折り返しは指定駅・指定列車に「次駅ですぐ折り返し」を追加。停車中は現在駅を飛ばして次の停車駅を選び、K/B境界でも同じphaseを使う。終点・次駅未取得では推測して駅を選ばず、駅指定への回復導線を示す。同じ公式時刻表・遅れ・移動bufferの評価を使い、時間不足を自動承認しない。指定列車の全駅時刻を照合できる場合は、同じ列車へ乗り換えられる共通駅も示す。通過済み、未取得、複数出現で曖昧な駅を除外する。全駅時刻を取得できないときは選択駅の判定を維持して説明する。

運行は公式normalだけを平常扱いとし、古い情報と通信断は未確認へ変更。現在の移動から条件を見直す検索入口を追加した。保存旅程のない手動乗車でも次駅・降車地点から検索を開く。無関係な古い検索履歴より現在の乗車区間を優先し、別経路を選ぶまで乗車案内を保持する。その他は既存設定にPrivacy、利用条件、権限/Version、時計を追加。通信断は画面共通の小さなBannerと各接近の予測表示へ切り替える。検索結果/詳細のsnapshotも90秒の観測期限・onlineを再判定し、古い実測は「保存時の遅れ・要更新」とする。ラベル更新だけを行い、経路DOMを保持する。

## SmartLiveの設計と検証の意味

- `transit-evidence.js`はGPS、Motion、Audio、Realtime、時刻表、旅程、路線patternを統一Eventで扱う。同じSourceの更新は上書きし、独立した複数票にはしない。Eventは期限付き・最大80件、駅contextは最大4分、GPS/音声の永続化はしない。
- timetable/選択旅程だけで乗車確定しない。少なくとも独立した観測2 Source、方向の裏付け、候補差、最低の元scoreを要求する。Motionだけで曖昧な方向を解決しない。歩行速度と端末の揺れだけの確定も拒否する。
- fresh GPSと2.8m/sを入口の必須条件から外した。停車速度0、GPS消失、直前駅から候補を保持できる。既存ride確定後はroute flipを止め、既存の到着/手動終了で解除する。
- 市バスはoperator / route / servicePattern / direction / destination / trip / serviceDateを識別。実catalogの204両方向と、循環終端を跨ぐ順方向/逆方向をモデルで検証する。route番号だけで決めない。
- 音声はline / route / destination / next stop / categoryへ分解し、候補内の文脈と照合する。駅名を聞いただけで候補ボタンをクリックする処理を削除した。
- マイク権限が明示的にgrantedと分かる場合だけ使う。自動乗車判定OFF・音声補助OFF・非表示・離脱では開始/継続しない。認識は最大6秒、試行間隔30秒、権限照合後にも状態を再確認して同時開始を防ぐ。MyMapに音声/文字起こしを保存・送信するコードを持たない。ブラウザーの認識サービスによる処理はPrivacyに説明した。
- これらは合成証拠と認識stubによる検証。実際の乗車精度、60秒以内、誤方向0件、実録音の認識性能を測った結果ではない。

## 実装ファイルと責務

|責務|主なファイル|
|---|---|
|Live / locale / 保存場所のアイコン|`public/js/live-home.js`, `locale.js`, `saved-places.js`|
|Evidence / アナウンス解析 / センサーと認識の寿命|`transit-evidence.js`, `announcement-parser.js`, `vnext-detect.js`, `motion-assist.js`, `vnext-core.js`|
|Pan/Pinch / Accuracy / 地理タイル / fullscreen|`route-map.js`, `now-navigation.js`|
|日時・条件・結果・CTA・画像保存|`route-search-ui.js`, `route-search-model.js`, `route-search-view.js`|
|交通条件 / 徒歩 / 始発終電 / 別便条件|`router.js`, `search-core.js`, `journey-plan.js`|
|折り返しと共通駅|`vnext-foldback.js`, `foldback-meetings.js`|
|Navigation / Sheet同期 / Offline / その他|`navigation.js`, `context-sheet.js`, `vnext.js`, `vnext-arrivals.js`, `arrival-stability.js`, `operation-status.js`, `vnext-network-view.js`, `timetable-ui.js`|
|Token・各画面のowner CSS・静的ファイルの版固定|`vnext.css`, `idle-experience.css`, `route-search.css`, `vnext-navigation.css`, `vnext-sheets.css`, `vnext-journey.css`, `scripts/build.mjs`|

旧 `route-search-home.js`は削除し、旧ホームをhiddenで残していない。document click routerの新規分岐は増やさず、Live/経路/保存場所のcontrollerが操作を所有する。

## 操作数

テストFlowの操作手順に基づく。文字入力・スクロールは別記。GPS/公式feed/保存先の条件が異なる場合は操作が増える。

|タスク|操作|条件|
|---|---|---|
|丸太町→国際会館で案内準備|Quick Select → 検索 → 候補 → 案内を開始：4tap|GPSで丸太町を取得、Quick Selectに国際会館|
|次の204|Liveの付近の交通（必要ならscroll）|対象停留所付近、接近データあり。分数が無ければ停留所前で表示|
|1本後|結果の1本後：1tap|取得済み経路あり|
|別便|発時刻 → 別便：2tap|変更可能な便あり。後続/運賃を再計算|
|乗車中の次駅|Liveを表示：0tap|乗車確定・時刻/位置情報の取得範囲内|
|次駅折り返し|折り返し → 次駅：2tapで可否、確認で保存|反対方向の公式便と到着時刻あり|

## iPhone実機・実走の試験表

|試験|必要な記録|今回の結果|
|---|---|---|
|烏丸線 北行・南行を複数回|iPhone/iOS、発車、検知までの秒数、次駅、GPS消失/復帰、誤方向|未実施・秒数未測定|
|近鉄・烏丸線直通 両方向|竹田K/B、会社/色/source、乗換不要、停車/発車|未実施|
|市バス 循環/反対方向/同一停留所両方向|系統/便/pattern、通過順、認識時間、誤周り|未実施・誤方向件数は未計測|
|北3 市バス便/京都バス便|営業日/休校条件、全停留所、降車案内|未実施|
|Safari / Standalone|OS Edge Back、キーボード、VoiceOver、Dynamic Type、Haptic|自動Browser相当のみ。物理端末は未実施|
|Background/Foreground|OS suspend後の位置/旅程/Realtime/音声再同期|ブラウザーイベント模擬のみ。物理suspendは未実施|

## 残存制限と判定

**Global Release Ready: NO（実走・物理iPhoneのP0判定が残る）。仕様全体100%とは報告しない。**

全既存画面の英訳は未完了。locale/time-zone基盤とLive主要辞書は整えたが、完全なEnglish版の公開とは異なる。京都バスODPTの本番利用条件が未設定の場合は既存の公式時刻表fallbackを使い、実測を装わない。始発/終電は取得済み運行日feedの範囲であり、欠測路線・改正/休校条件のcoverageは実データで継続確認が必要。

途中駅での自動降車・旅程変更後の自動再探索、運休の自動回避、運行路線お気に入り、未取得の番線/出口/乗車位置/バリアフリー情報は完成済みとしない。現在の手動終了、次区間案内、検索条件編集、公式運行の確認を維持する。iOSのHaptic・音声認識は対応するWeb APIと既存権限に依存する。

2026-10-16にユーザーの公開指示で本番へ反映した。公開結果は下記に記録する。実走結果が無いため、公開済みであることとGlobal Release Readyの認定は区別する。


## Push / Pop / Gesture の受入項目

|操作|自動Browserで確認する結果|実機との区別|
|---|---|---|
|Push / Pop|前画面と次画面の途中位置を採取、共通Motion、App/Browser Backの同じ親|OSのcompositor / Safari実機とは別|
|ゆっくりEdge Swipe|左端から指と画面が1:1、背後の画面が見える|Playwright pointerによる計測|
|30%で戻す / 50%で離す|前者cancel、後者pop、scroll/focus維持|物理touch未実施|
|Flick / PointerCancel|速度でpop、cancelで復元|物理iPhoneのOS edge競合は未実施|
|縦scroll / 地図 / Sheet / Tab付近|それぞれのcontrollerへ渡し、不用意なpopを開始しない|ネイティブ慣性scrollを利用|
|Sheet drag|1:1、backdrop追従、fit/medium/large、scrollTop競合|物理キーボード/OS gestureは別試験|
|長押しQuick Select|移動中の選択追従・release確定・cancel中止|Haptic実機は未確認|
|Tab復帰 / 戻る / reload|入力、結果、選択便、details、scroll、地図viewportを保持|保存可能なStateだけ永続化|

WebKitの画像保存後BackでSheetのHistory popとdownloadが競合したため、共通Navigationにdismiss transactionを設け、完了後に画像保存する。Workerの読込中の再読み込みはdocument離脱でabortし、Worker自身の失敗はinline errorとretryで扱う。エラーを単に無視して通すのではなく、意図的な503と回復をBrowserで試験する。

## 比較の読み方

Beforeは開始時main、Afterは今回の実装。34画面のLight/100%代表画像と追加の近鉄/直通/京都バスを保存する。全272状態のスクリーンショットと詳細座標はworkspaceのartifactに残し、repositoryには代表画像と座標集計を収録する。

固定feed/GPS/時計の画像でUIを比較する。多くの座標試験では地図タイルを固定画像に置換しているため、その背景を実地理の証拠にはしない。「実OSM Mini Map」の追加画像だけは実タイルをダウンロードして全画像のnaturalWidthとsource URLを確認する。乗車の画像は公式形式fixtureからの画面であり、実車で撮影したものではない。

## 公開前のローカル検証結果

2026-10-16にmainを再取得し `8f04791` のままであることを確認。Node 22.23.3 / Playwright 1.62.1。Browserはbuild `06ad19dcadc7` の固定したworkspace出力83ファイルを使用した。全ファイルのSHA-256を保存した。[runtime manifest](evidence/native-2026-10-15/runtime-manifest.json)。この検証時点では本番公開・merge前。以降の公開結果は次節に記録する。

|検証|結果|証拠|
|---|---|---|
|`npm run check` / `git diff --check`|成功、構文/HTML ID/差分を確認|再実行コマンドは下記|
|`npm test`|361件成功、失敗/skip 0|[モデル集計・関連テスト名](evidence/native-2026-10-15/model-tests.json)|
|`npm run build`|成功、`06ad19dcadc7`|[全静的ファイルのSHA-256](evidence/native-2026-10-15/runtime-manifest.json)|
|Chromium Browser|596検査、page error 0|[JSON](evidence/native-2026-10-15/chromium-report.json)|
|WebKit Browser|596検査、page error 0|[JSON](evidence/native-2026-10-15/webkit-report.json)|
|Chromium / WebKit PWA|各9項目成功。install/update/offline/旧client/失敗precacheを確認|[Chromium](evidence/native-2026-10-15/chromium-pwa-report.json) / [WebKit](evidence/native-2026-10-15/webkit-pwa-report.json)|
|34画面の拡張座標検査|272状態、最小target 44px、独立action間隔8px、衝突/文字切れ0|[集計](evidence/native-2026-10-15/coordinates-summary.json) / [実行結果](evidence/native-2026-10-15/coordinate-report.json)|
|実地理Browser検査|210検査成功。実OSMのbus mapと既存Navigation/折り返しも確認|[JSON](evidence/native-2026-10-15/real-map-report.json)|
|Worker bundle|dry-run成功、本番deployなし|[JSON](evidence/native-2026-10-15/worker-report.json)|
|実OSM Mini Map|全タイル読込・naturalWidth・URL・現在地/近く表示を確認|[画像](evidence/native-2026-10-15/after/live-real-basemap-390.png) / [JSON](evidence/native-2026-10-15/live-real-map.json)|

Browserは390×844のLight/Dark、文字100/150/200%、High Contrast、Reduce Motion、位置情報ON/OFF、通常Browser/Standalone相当を含む。全596検査は596個の異なる画面という意味ではない。34画面の拡張検査は390pxの6状態と805pxの2状態で272。

SmartLiveでは重複GPS、歩行＋端末の揺れ、地下のGPS消失、停車速度0、期限切れ、逆方向/曖昧、確定後のflip抑制、循環終端、実catalogの204両方向、構造化アナウンスの照合が成功。Browserでは未許可マイク開始0、許可済みの認識stubの6秒停止・設定OFF即時停止を確認した。実録音や実際の方向精度の測定ではない。

検索の期限切れ/通信断では経路DOMを保持してsourceだけ変化する。Worker moduleを保留したままreloadしてもunhandled errorなし。実際にWorkerへ503を返すとinline recoveryになり、再試行で本物のWorkerの候補が出る。手動乗車と古い検索履歴が共存しても運行の再検索は現在の次駅から開く。

既存の性能fixtureではGPS更新10回による追加接近request 0、変更のないrowのmutation 0、通常更新間隔20秒。これは限定したfixtureの結果であり、実端末のfps/電池消費の実測値ではない。

再実行:

```sh
npm run check
npm test
npm run build
npm run test:browser
npm run test:pwa
BROWSER_ENGINE=webkit npm run test:browser
BROWSER_ENGINE=webkit npm run test:pwa
BROWSER_UI_AUDIT=1 npm run test:browser
BROWSER_SPEC_ONLY=1 VERIFY_LIVE_MAP=1 npm run test:browser
```

今回のWebKitはLinuxで実エンジンを動かしている。workspaceのuserlandライブラリを使うためホストライブラリの事前探索だけをskipした。物理iPhoneのSafariを操作したという意味ではない。

## Before / Afterと引継ぎ

[37組の画面比較・Motion途中画像](evidence/native-2026-10-15/README.md) にLive未乗車、烏丸線、近鉄、直通、市バス、京都バス/北3、検索、結果、Journey、時刻表、運行、その他、折り返しを収録した。上の配置/Navigation Mapと合わせてレビューする。

[次のChatGPT Work用メモリ](chatgpt-work-next-iteration-memory.md) を今回のLive仕様で更新した。古いYahoo同画面指示を最新仕様として再適用せず、単一検索Stateと既存5Stackを維持する。残る実走/物理端末/翻訳/運行回避等の課題は本書の試験表と残存制限を引き継ぐ。


## 本番公開結果（2026-10-16）

公開先: **https://at5tram98-hash.github.io/kyoto-transit/** 。frontend build **`06ad19dcadc7`**。UI実装 `2659964` をPR #2でmain `0a99bf8` にmergeし、Pagesが02:19:04 UTCにdeployを完了した。追加のAPI修正 `6248187` はPR #3でmain `f26fb06` にmergeし、Workerへ反映した。[公開記録JSON](evidence/native-2026-10-15/production-release.json)。

|公開・検証対象|結果・証拠|
|---|---|
|frontend / Pages|[run 38837839758](https://github.com/at5tram98-hash/kyoto-transit/actions/runs/38837839758) SUCCESS。build/deploy/公開確認成功|
|backend / Worker|[run 38840924385](https://github.com/at5tram98-hash/kyoto-transit/actions/runs/38840924385) SUCCESS。構文・363モデル・bundle・deploy・公開確認成功|
|Pages CI Browser|Chromium/WebKit各596検査、PWA各9、実地理210成功。[Chromium](evidence/native-2026-10-15/ci-chromium-report.json) / [WebKit](evidence/native-2026-10-15/ci-webkit-report.json) / [PWA Chromium](evidence/native-2026-10-15/ci-chromium-pwa-report.json) / [PWA WebKit](evidence/native-2026-10-15/ci-webkit-pwa-report.json) / [実地理](evidence/native-2026-10-15/ci-real-map-report.json)|
|修正後の実運行API・配信|02:35:20 UTC、必須9項目成功。[JSON](evidence/native-2026-10-15/production-report.json)。京都バスODPTはoptional未設定で公式時刻表fallback|
|キャッシュ連続取得|近鉄APIは200→200→200、同一ETag条件付き取得304。CORS・本文・live sourceを確認。[JSON](evidence/native-2026-10-15/rail-cache-after.json)|
|実公開Browser|当日丸太町→京都検索、11:27発を11:42発へ変更、11:49着、案内準備→reload→全旅程→Back→解除成功。例外0。[JSON](evidence/native-2026-10-15/production-browser-report.json)|
|実公開PWA更新|実際の旧公開版`0e633053b133`→新版`06ad19dcadc7`更新を操作。更新待機中の旧画面と更新後の選択tripId・全旅程を保持。例外0。[JSON](evidence/native-2026-10-15/production-update-report.json)|

実公開Browser/PWA試験ではAPI・時計・GPS・タイルのfixtureを使用していない。新規Service Worker install、version別static cache、controlled reload、実OSM画像の読込も確認した。案内準備の検証であり、実際に電車に乗ったことや自動乗車認識の現地精度を示すものではない。[実公開8画像](evidence/native-2026-10-15/README.md#本番公開後の実画面2026-10-16)。

### 公開確認で見つかったAPI障害と修正

初回の追加公開確認では近鉄APIだけ500となった。[失敗した初回確認](evidence/native-2026-10-15/production-first-check.json) と [連続取得200→500→500](evidence/native-2026-10-15/rail-cache-before.json) を保存する。Cloudflare Cache APIの変更不可Headersへ、共通応答処理で直接CORSを書き込んだことが原因だった。

`worker/index.js`の既存`finalize`でResponseを再構成してからHeadersを追加する。本文・status・ETag・304の空本文を保持し、cache側の応答を変更しない。`tests/worker-cached-response.test.js`は実際のFetch応答のimmutable guardで修正前のTypeErrorを再現し、修正後に200/304とも成功した。全モデルは361から363へ増え、失敗・skip 0。[集計](evidence/native-2026-10-15/worker-cache-models.json)。修正後のWorker CIと実連続取得は上表のとおり成功した。

このbackend修正で`public/`は変更していない。検証・配信済み83ファイルのSHA-256は`06ad19dcadc7`のmanifestと同一。そのため同じfrontendを再配信するPages run `38840924434`はcancelledとし、成功として数えない。frontendは成功したPages run、backendは成功した最新Worker runをそれぞれ根拠にする。

本番反映は完了。物理iPhone・実走・未完了の英訳等の残課題と **Global Release Ready: NO** は上記のとおり継続する。
