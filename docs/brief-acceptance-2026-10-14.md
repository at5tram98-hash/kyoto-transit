# 添付34画面資料の対応・Acceptance

基準は [ユーザー提供資料](reference/mymap-34-screen-brief-2026-10-14.txt)。資料0章の100%は「現在この環境で検証可能な項目すべて」であり、物理iPhoneを遠隔操作したという意味ではない。未確認を確認済みと報告しない条件も適用する。

**34画面の照合完了と、全改善案の実装達成率100%は別である。** この表には既存維持と条件付き非追加が含まれる。未実装・未測定を除いて算出した、全機能の達成率を示す表ではない。ユーザーからの再照合に対する画面別判定は [34画面の達成率再照合](brief-achievement-audit-2026-10-14.md) を参照。

## 優先5項目

|資料|実装|検証|
|---|---|---|
|P0-1 区間便変更|発車時刻→公式便→後続再探索→プレビュー→確定、serviceId/tripId/serviceDate/from/to・versionを照合|後続便変更、buffer/walk/dwell/fare/pass、日跨ぎ、到着締切、未取得、方向違い、接続なし、取消、実tripId、Tab/Back/Reload|
|P0-2 Journey Rail|時刻列・線・ノード・発着・徒歩・滞在・待ち・番線・途中駅・source・料金を連続表示|390px Light/Dark 100/150/200%、途中駅開閉、CTA hit、旧機能保持|
|P0-3 到着優先|系統/行先/到着を主、のりば/混雑/遅れを補助、source/行別時刻を第三階層へ|全行・方面、実測1停留所前、予測混在、Reduce Motion、行/marker DOM保持|
|P1-1 停留所詳細|系統chip、既知の次便2〜3件、全接近へのPush|chip切替→全接近→Back、表示中だけpoll、未取得を分数に換算しない|
|P1-2 全Journey連携|次の降車・徒歩・乗換・次発・取得済みのりば、全旅程Push、次便準備・実乗車・最後の徒歩|保存/再開/乗車/降車/次便/終了、変更した降車地点の警告、GPSや時刻だけで乗車と断定しない|

## 34画面

|番号・画面|資料への対応|
|---|---|
|01 未乗車|GPSが確定した場合だけ近隣地点・公式発車/取得済み接近を表示。全面地図化しない|
|02 quick-search|既存Progressive Disclosureを保持|
|03 search|既存出発/到着/経由/日時を保持。未整備の始発/終電/住所/歩行速度のUIを作らない|
|04 stop-picker|既存事業者・路線・英語・駅番号・別名・同名地点ID選択を保持。feed統合もtyped operatorを照合|
|05 search-via|最大3経由と滞在を保持。降車/0分滞在/乗換余裕の意味を説明|
|06 search-filter|探索できる既存条件を保持、見た目だけの条件を増やさない|
|07 results|1本前を追加。次の全経路検索とLeg便変更を分離。sort/比較/条件/保存保持。更新でtapを失わない|
|08 route-detail|Journey Railと区間便変更を実装|
|09 route-stops|概要→途中駅の展開を保持。戻っても展開状態を保持|
|10 rail-ride|大きなHeroを保持。次の行動/全Journeyを追加|
|11 rail-stops|既存現在/次/降車の差と通過済み文言を明示|
|12 station-detail|既知の到着・路線・設定・時刻表。番線や設備を捏造しない|
|13 destination-sheet|既存短い設定Sheetを保持、改めた降車地点と旧Journeyの不整合を警告|
|14 foldback-home|固有機能と駅/列車の2モードを保持|
|15 foldback-station|ホーム移動と駅選択を保持、通常検索と責務を分離|
|16 foldback-trains|反対列車・保存・検索を保持。既存公式便と共通乗車モデルを選便へ利用|
|17 foldback-confirm|到着/移動/余裕/実列車を保持|
|18 ride-map|詳細Full Screenとzoom/pan保持。実地理タイル、ホーム全面地図にしない|
|19 delay-analysis|公式予定/実測/自分の推定を説明。曖昧な情報で全Legへ一律遅れを足す処理を廃止|
|20 live-trains|前方/反対方向・近鉄/直通の情報を保持|
|21 bus-ride|次停留所・小さい地図・降車・次の行動。鉄道との機能差を保持|
|22 bus-stops|通過済み/次/降車を明示|
|23 bus-stop-detail|P1-1実装、未取得のKyoto Bus実測は公式時刻表へ|
|24 arrivals|P0-3実装、source/混雑/のりば/遅れ/位置/全方面を保持|
|25 timetable-home|保存した経路の実在する駅/停留所をショートカットへ接続。別の保存ストアを増やさない|
|26 station-timetable|方向/曜日/時間/便を保持。区間便選択とは別画面|
|27 timetable-trip|全駅・運行日・時刻・現在乗車の共通モデルを保持/利用|
|28 operations|現在乗車/全Journey/最後の検索で使う路線を優先、他事業者も表示|
|29 operation-detail|公式本文を保持。未取得の構造化障害区間で自動回避を捏造しない|
|30 settings|既存Push分類を維持、主画面を巨大化しない|
|31 pass|検索結果に実際の定期適用を表示。実乗車日の有効期限で再計算|
|32 distance|最新GPSがある場合の実駅数。未取得/古いGPSは未確認と表示|
|33 routes|正確な既存対応範囲を維持。全国対応と装わない|
|34 info|実測/予測/予定/公式/推定・各行更新時刻・位置情報の意味を説明|

## 禁止事項と条件付き提案

既存Hero・Realtime・source・定期・折返し・GPS・通知・全停留所・直通・設定・4Tabを保持。地図のホーム全面表示、Google配色コピー、取得していない運賃/番線/出口/乗車位置/施設/住所/障害回避/車椅子経路などのUIだけの追加を行わない。資料11章はデータ整備を条件とする将来提案であり、裏付けなく「対応済み」と扱わない。

Google iPhone向け公式ヘルプとYahoo公式紹介を2026-10-14に再取得し、発車時刻選択、後続交通の更新、前後便、発着・ホーム・途中駅、実測と予定の違いを再確認した。競合の物理iPhone操作と混同しない。

- https://support.google.com/maps/answer/6142130?hl=ja&co=GENIE.Platform%3DiOS
- https://transit.yahoo.co.jp/promo/app/

## 証拠と公開

[改修・検証・Before/Afterレポート](journey-upgrade-2026-10-14.md)、[次のWorkへのメモリ](chatgpt-work-next-iteration-memory.md)、[Visual Difference Matrix](visual-difference-matrix-2026-10-12.md)を参照。Node/model、WebKit/Chromium、34画面、Navigation/Swipe、PWA、地理タイル、Worker/Pages、本番APIを公開CIと実接続で最終確認し、成功結果をレポートへ記録する。


## 完了判定（クラウド検証範囲）

2026-10-14、公開コード `5b1b57f3` / build `af4813c8cc67` で完了。優先5項目と34画面の改修/保持/条件付き非追加を確認し、資料0章で定義されたクラウドで検証可能な範囲をすべて確認した。

Pages CI 38513683449 SUCCESS。333モデル、WebKit/Chromium各458、PWA各9、実地理210、bundle/Pages公開/本番実運行API確認に成功。公開Webでも実ダイヤの検索→別便→再計算→旅程準備→Back/取消を操作し例外0。比較画像と詳細根拠は改修レポートの最終公開結果に記録した。

条件付き将来データ整備や物理iPhoneの操作を完了扱いにしていない。これは資料0章・11章の条件に従う。次の段階の改善はWorkメモリに残した。
