# 仕様残差解消の検証原本（2026-10-17）

対象frontend **`fa429f63131d`**、87配信ファイルのSHA-256は [manifest](runtime-manifest.json)。Beforeは公開build `06ad19dcadc7`、本番反映前のmain `dfd4352`。Afterの34画面は390×844・Light・100%。交通/GPS/時計/通常の背景タイルは固定fixtureであり、実車や本番Realtimeの証拠ではない。

[全272状態の座標原本](coordinates.json) / [座標検査](release-coordinates-report.json) / [モデル375件](model-tests.json) / [英語58状態Chromium](release-completion-report.json) / [英語58状態WebKit](release-webkit-completion-report.json) / [WebKit PWA](webkit-pwa-report.json)。失敗した途中runを成功結果に混ぜていない。

## Before / After

既存のレイアウトと機能を保持し、言語・表示Tokenの所有、障害回避・後続再探索・運行保存の導線を統合した。同じ画面で見た目の差が小さい箇所も、回帰確認の対象から除外しない。

|画面|Before `06ad19`|After `fa429f`|
|---|---|---|
|arrivals|[画像](../native-2026-10-15/after/arrivals.png)|[画像](after/arrivals.png)|
|bus-ride|[画像](../native-2026-10-15/after/bus-ride.png)|[画像](after/bus-ride.png)|
|bus-stop-detail|[画像](../native-2026-10-15/after/bus-stop-detail.png)|[画像](after/bus-stop-detail.png)|
|bus-stops|[画像](../native-2026-10-15/after/bus-stops.png)|[画像](after/bus-stops.png)|
|delay-analysis|[画像](../native-2026-10-15/after/delay-analysis.png)|[画像](after/delay-analysis.png)|
|destination-sheet|[画像](../native-2026-10-15/after/destination-sheet.png)|[画像](after/destination-sheet.png)|
|foldback-confirm|[画像](../native-2026-10-15/after/foldback-confirm.png)|[画像](after/foldback-confirm.png)|
|foldback-home|[画像](../native-2026-10-15/after/foldback-home.png)|[画像](after/foldback-home.png)|
|foldback-station|[画像](../native-2026-10-15/after/foldback-station.png)|[画像](after/foldback-station.png)|
|foldback-trains|[画像](../native-2026-10-15/after/foldback-trains.png)|[画像](after/foldback-trains.png)|
|live-trains|[画像](../native-2026-10-15/after/live-trains.png)|[画像](after/live-trains.png)|
|now-home|[画像](../native-2026-10-15/after/now-home.png)|[画像](after/now-home.png)|
|operation-detail|[画像](../native-2026-10-15/after/operation-detail.png)|[画像](after/operation-detail.png)|
|operations|[画像](../native-2026-10-15/after/operations.png)|[画像](after/operations.png)|
|rail-ride|[画像](../native-2026-10-15/after/rail-ride.png)|[画像](after/rail-ride.png)|
|rail-stops|[画像](../native-2026-10-15/after/rail-stops.png)|[画像](after/rail-stops.png)|
|ride-map|[画像](../native-2026-10-15/after/ride-map.png)|[画像](after/ride-map.png)|
|route-detail|[画像](../native-2026-10-15/after/route-detail.png)|[画像](after/route-detail.png)|
|route-stops|[画像](../native-2026-10-15/after/route-stops.png)|[画像](after/route-stops.png)|
|search-date|[画像](../native-2026-10-15/after/search-date.png)|[画像](after/search-date.png)|
|search-filter|[画像](../native-2026-10-15/after/search-filter.png)|[画像](after/search-filter.png)|
|search-results|[画像](../native-2026-10-15/after/search-results.png)|[画像](after/search-results.png)|
|search-via|[画像](../native-2026-10-15/after/search-via.png)|[画像](after/search-via.png)|
|search|[画像](../native-2026-10-15/after/search.png)|[画像](after/search.png)|
|settings-distance|[画像](../native-2026-10-15/after/settings-distance.png)|[画像](after/settings-distance.png)|
|settings-info|[画像](../native-2026-10-15/after/settings-info.png)|[画像](after/settings-info.png)|
|settings-pass|[画像](../native-2026-10-15/after/settings-pass.png)|[画像](after/settings-pass.png)|
|settings-routes|[画像](../native-2026-10-15/after/settings-routes.png)|[画像](after/settings-routes.png)|
|settings|[画像](../native-2026-10-15/after/settings.png)|[画像](after/settings.png)|
|station-detail|[画像](../native-2026-10-15/after/station-detail.png)|[画像](after/station-detail.png)|
|station-timetable|[画像](../native-2026-10-15/after/station-timetable.png)|[画像](after/station-timetable.png)|
|stop-picker|[画像](../native-2026-10-15/after/stop-picker.png)|[画像](after/stop-picker.png)|
|timetable-home|[画像](../native-2026-10-15/after/timetable-home.png)|[画像](after/timetable-home.png)|
|timetable-trip|[画像](../native-2026-10-15/after/timetable-trip.png)|[画像](after/timetable-trip.png)|

## 今回追加した検証

|状態|画像|
|---|---|
|English Live|[画像](after/completion-en-light-1-live.png)|
|English Search|[画像](after/completion-en-light-1-search.png)|
|English Results|[画像](after/completion-en-light-1-results.png)|
|English Journey / Dark / 200%|[画像](after/completion-en-dark-2-journey.png)|
|English Settings / 200%|[画像](after/completion-en-light-2-settings.png)|
|全旅程の後続便選択|[画像](after/completion-en-light-1-future-services.png)|
|選便後の全旅程|[画像](after/completion-en-light-1-future-updated.png)|
|運休対象を除外した実router検索|[画像](after/completion-disruption-avoided.png)|
|途中降車後の再検索|[画像](after/completion-onward-recalculated.png)|
|翌運行日の実feed接続|[画像](after/completion-midnight-connection.png)|

後続便選択では乗車中/完了区間の便・時刻を固定し、現在のphase/idを保持した。回避検索では候補選択まで案内を維持した。途中降車は明示操作であり、合成時刻だけで乗降を確定していない。深夜接続は当日23:55→翌日00:05で、元のserviceDateを維持する。

## 外部連携と実機の区別

[厳格モードの公開前実接続原本](providers-before-report.json) は必須9項目成功・京都バスODPT `blocked_external`・overall false。環境内の候補キーを公式APIに渡すと403 `Invalid acl:consumerKey.`、本番healthは `odpt:false`。値をログやソースに記録せず、無効な値を本番へ登録していない。

iPhoneのOS Edge、VoiceOver、実際の触覚、OS suspend、実路線の検知時間/誤方向は未試験。WebKitの自動成功を物理iPhoneの成功と読み替えない。対応Web APIのないSafariでは触覚は提供できない。全体100% / Global Release Readyは認定しない。

本番公開・CI・fixtureなしのHTTPS検証結果は [実装報告](../../spec-completion-2026-10-16.md) に追記する。
