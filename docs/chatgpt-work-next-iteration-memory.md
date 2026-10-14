# ChatGPT Work 引継ぎ：Google Maps・Yahoo!乗換案内とMyMapの操作差

更新: 2026-10-14。対象 `at5tram98-hash/kyoto-transit`、本番 https://at5tram98-hash.github.io/kyoto-transit/ 。最初にmainを取得し、その時点のコード・公開build・テストを再確認する。古い検証結果を現在の動作の証拠としない。

## 基準と変更禁止

- ユーザー提供資料は `docs/reference/mymap-34-screen-brief-2026-10-14.txt`。資料中の100%という評価、CI成功、競合操作の記述は提供された情報であり、現在のMyMapや競合実機の実測結果として転用しない。
- 添付資料全体の対応表は `docs/brief-acceptance-2026-10-14.md`。最新の改修と検証は `docs/journey-upgrade-2026-10-14.md`。既存34画面の比較は `docs/ui-ux-screen-comparison-2026-10-13.md`、公式参照元は `docs/transit-comparison-2026-10-13.md`。
- PDF `MyMap_UI_Design_Spec_2026_Updated.pdf`、WORK HANDOFF v1.1、`docs/design-spec-v1.1-2026-10-12.md`、`docs/navigation-architecture-2026-10-13.md`、Visual Difference Matrixも基準にする。
- iOSの既存デザインを大きく変更しない。地図をホームの主役にしない。機能を削除しない。CSS末尾で大量上書きしない。巨大なdocument click router、別のダミー探索・Navigationを作らない。許可済みの作業でプラグイン確認を繰り返さない。
- 烏丸線・近鉄・直通・K/B境界、北3・全既存バス／停留所、次駅Hero、降車、前方／反対方向列車、Realtime、遅延、全駅時刻表、折返し、運行・接近、運賃／定期、地図、GPS、通知、Dark Mode、Dynamic Type、Reduce Motion、設定を維持する。

## 競合について確認できた差

Google MapsのiPhone向け公式ヘルプは、出発駅付近の後発時刻、他の出発情報、選便後の現在・後続交通機関の時刻更新を説明している。Yahoo!の公式紹介画面では早・楽・安、一本前／後、発着・ホーム・途中駅・乗車位置などが見られる。これらの公式資料と競合の実機タップ座標・モーション・ジェスチャーを区別する。競合アプリを実機で完全操作したとは報告しない。

- https://support.google.com/maps/answer/6142130?hl=ja&co=GENIE.Platform%3DiOS
- https://support.google.com/maps/answer/144339?hl=ja&co=GENIE.Platform%3DiOS
- https://transit.yahoo.co.jp/promo/app/
- https://transit.yahoo.co.jp/

MyMapは交通中心の4タブと独立Stackを持つ。Googleの地図中心ホームをコピーする必要はない。便選択・接続再計算・状態保持・情報の優先順位を取り入れる。

## 2026-10-14に実装済みのもの

1. 経路詳細の各「発車時刻」→便選択Push→公式便のList Row→後続旅程のプレビュー→確定→同じ経路詳細。発車表示だけを差し替えず、後続乗車・徒歩・滞在・buffer・到着・全区間運賃・定期・案内対象tripIdを既存router/faresで再計算する。
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
- 番線・乗車位置・入口／出口・歩行速度・POI・住所・運休回避・施設の段差・車椅子経路・網羅的な始発／終電はデータ整備が必要。取得していないものをUIだけで追加しない。
- 京都バスODPTはoptional未設定。市バス・近鉄の便別tripId/運行日・位置照合のcoverageを計測する。APIの欠測率、取得時間、方面別coverageを継続計測し、1回のproduction成功を常時安定と解釈しない。
- 市バスの4秒timeout、20秒更新、全方面fallback、予測source、quota-safeなKV書込みを維持する。古いcacheを実測と表示しない。

## 必須検証

Node22環境で `npm run check`、`npm test`、`npm run build`、`npm run test:browser`、`npm run test:pwa`。`BROWSER_UI_AUDIT=1 npm run test:browser`は34画面の拡張座標検査。`BROWSER_JOURNEY_ONLY=1`は選便・接続・全旅程・地点接近の新フロー。

390×844 Light/Dark、文字100/150/200%、Reduce Motion、GPS ON/OFF、805px、320px、44px以上のtarget、独立action間隔8px以上、CTA hit、App/Browser/Swipe Back、scroll/Tab/reload、実タイルを確認する。競合とMyMapのSource、情報量、操作を画面別に比較し、Before/After・座標JSON・選択した実tripId・通ったテスト・公開build・残存課題を報告する。検証結果は今回の改修レポートを参照し、再作業時に取り直す。


## 今回の最終検証・公開版

main実装 `5b1b57f3`、公開build `af4813c8cc67`。Pages CI 38513683449 SUCCESS、Worker CI 38500581938 SUCCESS。333モデル、WebKit/Chromium各458、PWA各9、実地理210。ローカル拡張34画面272状態はtarget最小44px、独立action最小8px、clipping/collision0。

本番をbuild固定で実接続検証し、2026-10-14T05:13:18.954Zに必須9項目passed。京都バスODPTだけoptional未設定。さらに実公開WebでAPI/時計/GPS/tileのfixtureなしに当日ダイヤ検索・14:19→14:27別便・確定・全旅程準備・Back/取消を操作し例外0。現在の成功を将来の常時安定と取り違えない。

CIで確認したフォント差のチェックmarkは固定SVGで解消済み。status-only更新はcardを保持する。実際に内容が変わってもpointer/click delivery/keyboard focus中は描画を待ち、screen hide/disposeでtimer/listenerを清掃する。新しい回帰試験でこの操作競合を維持すること。
