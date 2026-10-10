# My Map — 京都のリアルタイム路線案内

京都市営地下鉄烏丸線・近鉄京都線・京都バス・京都市バスの対応範囲を、時刻表、現在地、公式運行情報から案内するPWAです。経路検索はアプリ内の静的ダイヤを使用し、取得できない交通機関を架空ダイヤで補完しません。

公開アプリ: https://at5tram98-hash.github.io/kyoto-transit/

## 対応範囲

- 京都市営地下鉄烏丸線: 全線
- 近鉄京都線: 全線、烏丸線との直通列車
- 京都バス: 40、特40、直行40、対象の臨時系統
- 京都市バス: 10、13、43、46、78、93、202、202八条口、204、205、206、208

## 構成

- `public/`: GitHub Pagesへ公開するPWA
- `worker/`: Cloudflare Worker。静的ダイヤ、公式運行画面、リアルタイムデータを正規化
- `tests/`: GTFS解析、版選択、経路探索、運賃、カレンダー、公式時刻表照合

Workerは生のGTFS ZIPを公開リポジトリへ保存しません。定期処理中だけ取得し、必要路線に縮約したJSONをKVへ保存します。

## 静的ダイヤの更新

Cloudflare Cron Triggerは `15 * * * *` で、毎時15分に1ステップだけ実行します。`worker/static-refresh.js` の `runRefreshStep()` が9段階を順番に進めるため、通常は約9時間で1巡します。1回の実行で外部取得を詰め込みすぎず、Cloudflareのサブリクエスト上限を避ける構成です。

更新順序:

1. `odpt:kyotobus`
2. `odpt:citybus`
3. `odpt:subway`
4. `subway:current`
5. `subway:opposite`
6. `kintetsu:current:south`
7. `kintetsu:current:north`
8. `kintetsu:opposite:south`
9. `kintetsu:opposite:north`

KVキー:

- `static:kyotobus`
- `static:citybus`
- `static:subway`
- `static:meta:<operator>`
- `static:last-refresh`
- `manual:kintetsu:weekday`
- `manual:kintetsu:weekend`
- `manual:kintetsu:status`
- `manual:subway:weekday`
- `manual:subway:weekend`
- `manual:subway:status`

### GTFS版の選択規則

`worker/static-gtfs.js` の `selectGtfsVersion()` で固定しています。

1. 検索対象日が `effectiveFrom <= date <= effectiveTo` を満たす版だけを候補にする。
2. 対象日より未来に公開予定の版を使わない。
3. 同じ対象日に複数版が有効なら、臨時・イベント・特別ダイヤを通常版より優先する。
4. 同順位なら有効開始日が新しい版を優先する。
5. さらに同順位なら版の日付、カタログ更新日の順で新しいものを優先する。

この順序は単体テストで固定しています。京都バスのオープンキャンパス等、通常版と臨時版が重なるケースを想定しています。

### GTFS軽量JSONスキーマ

`worker/static-gtfs.js` が実際に保存する形式です。時刻はサービス日0:00からの分で、24時以降もそのまま保持します。`calendarDates` は通常曜日より優先します。

```json
{
  "schemaVersion": 2,
  "operator": "citybus",
  "source": "https://ckan.odpt.org/...",
  "version": {"versionDate":"YYYY-MM-DD","effectiveFrom":"YYYY-MM-DD","effectiveTo":"YYYY-MM-DD"},
  "revisionDate": "YYYY-MM-DD",
  "lastUpdated": "ISO-8601",
  "validFrom": "YYYY-MM-DD",
  "validTo": "YYYY-MM-DD",
  "stops": [{"id":"...","name":"...","lat":35.0,"lng":135.0,"platform":null}],
  "routes": [{"id":"...","shortName":"205","longName":"...","type":3,"category":"local"}],
  "trips": [{
    "id":"...","routeId":"...","serviceId":"...","headsign":"...","direction":0,"shapeId":"...",
    "stops":["stop-a","stop-b"],"arrivals":[480,482],"departures":[480,482]
  }],
  "calendar": [{"serviceId":"...","start":"YYYY-MM-DD","end":"YYYY-MM-DD","week":[true,true,true,true,true,false,false]}],
  "calendarDates": [{"serviceId":"...","date":"YYYY-MM-DD","exception":1}],
  "shapes": [{"id":"...","points":[[135.0,35.0],[135.1,35.1]]}]
}
```

## 地下鉄の期間限定GTFSと公式時刻表fallback

公共交通オープンデータセンターで京都市営地下鉄GTFSが期間限定公開となる可能性があります。本アプリでは、公開終了後の長期アーカイブ利用を当然に許可されたものとは扱いません。継続保存・再利用が許可されていると明示確認できない場合は、古い保存版に依存せず京都市交通局の公式時刻表から生成するJSONへ切り替えます。

`worker/manual-subway-feed.js` は平日/土休日ごとに烏丸線15駅の公式発車表を読み、同方向の時刻を駅順に一対一照合します。公式駅時刻表に存在しない時刻を中間駅へ補いません。終着駅には同方向の発車表が存在しないため、**終着駅の到着分だけ**直前駅からの2分を導出値として持ち、`meta.terminalArrivalDerived: true` を必ず記録します。駅間対応が崩れ、全線を十分に照合できない場合は生成自体を失敗させます。

保存形式:

```json
{
  "schemaVersion": 1,
  "source": "https://www2.city.kyoto.lg.jp/kotsu/tikadia/hyperdia/menu022.htm",
  "revisionDate": "2025-02-22",
  "lastUpdated": "ISO-8601",
  "validDates": ["YYYY-MM-DD"],
  "stops": [{"id":"K01","name":"国際会館","type":"subway"}],
  "services": [{
    "id":"manual:subway:...","operator":"subway","label":"地下鉄烏丸線","category":"local",
    "stops":["K01","K02","...","K15"],
    "trips":[{"id":"...","date":"YYYY-MM-DD","arrivals":[...],"departures":[...],"headsign":"竹田"}]
  }],
  "meta": {"operator":"subway","method":"official-station-timetable-json","terminalArrivalDerived":true}
}
```

`readStatic()` はODPT地下鉄GTFSが対象日に有効かつ最終取得から48時間以内ならGTFSを優先し、それ以外では公式時刻表fallbackを使用します。fallback自体も14日以上更新できなければ短い警告を出します。クライアントではODPT固有の停留所IDを駅名で内部の `Kxx` IDへ正規化してから使うため、ODPT版と公式fallback版のどちらでも同じ乗車判定・列車位置計算を行えます。

## 近鉄の時刻表JSON

近鉄は本アプリで利用できる静的GTFSを確認できていないため、公式の全駅発車表から検索用feedを生成します。`worker/manual-rail-feed.js` は京都〜大和西大寺の有効な両方向発車表を読み、普通・急行だけを対象に同一の `tx`（便ID）を駅間で結合します。特急等は対象外です。

保存形式:

```json
{
  "schemaVersion": 1,
  "source": "https://eki.kintetsu.co.jp/norikae/",
  "revisionDate": "YYYY-MM-DD",
  "lastUpdated": "ISO-8601",
  "validDates": ["YYYY-MM-DD"],
  "stops": [{"id":"B01","name":"京都","type":"kintetsu"}],
  "services": [{
    "id":"manual:...","operator":"kintetsu","label":"近鉄京都線","category":"express",
    "stops":["B01","B02","K15","B07","B24"],
    "trips":[{"id":"1-...","date":"YYYY-MM-DD","arrivals":[...],"departures":[...],"headsign":"..."}]
  }],
  "meta": {"operator":"kintetsu","revisionDate":"YYYY-MM-DD","lastUpdated":"ISO-8601","method":"official-board-tx-join","boardCount":50,"terminalDerived":0}
}
```

南行は京都〜平城の25発車表、北行は東寺〜大和西大寺の25発車表を取得し、合計50方面の駅発車表から便を再構成します。終着駅には同方向の発車表が存在しないため、終着到着時刻だけは同じ方向・同じ種別の実測駅間時間の中央値を利用できる場合に限って導出し、その件数を `meta.terminalDerived` に記録します。中間駅の時刻は発車表に存在する実データを使い、架空の固定駅間時間で補いません。

更新手順:

1. Cronが南行・北行を別ステップで取得する。
2. 公式発車表の改正日を `revisionDate` に記録する。
3. 両方向のステージが揃った時点で `tx` ごとに全駅を結合する。
4. 結合後の便数が60便未満、または利用駅が24駅未満なら完全な生成として採用しない。
5. 平日と土休日の両パターンをKVへ保存する。
6. 14日以上再取得できていない場合は画面へ短い警告を出す。
7. 公式HTMLの目的要素が消失した場合は更新失敗として扱い、前回成功データを維持する。

## アプリ内経路検索

`public/js/search-core.js` と `public/js/router.js` が静的ダイヤを探索します。

- 出発時刻指定 / 到着時刻指定
- 乗換余裕 1 / 3 / 5 / 10分
- 徒歩上限 10 / 20 / 30分
- 近鉄 普通のみ / 急行のみ / 両方
- 「早い」「安い」「乗換少」の最大3案
- 区間タイムライン、通常運賃、設定した定期券適用後の追加額
- 京都バス・市バス・近鉄のリアルタイム/予測遅延を到着時刻へ反映
- 実測/予測/予定を小さな点で区別

静的feedが未準備の事業者は候補から外し、時刻を推測して経路を作りません。

## 乗車中・接近表示の時刻精度

- 地下鉄の自動乗車判定は、その日の静的feedにある各駅の実時刻を使います。通常系では一律2分刻みの仮時刻を作りません。
- 地下鉄の「同じ路線の列車」は、各駅の時刻間を補間して駅間位置を推定します。静的feedを取得できない場合だけ従来の軽量fallbackを使います。
- 近鉄の「あと○分」は、公式列車位置の現在セルを同日の静的時刻表の同方向・同種別・行先候補へ照合し、列車位置時点の予定時刻と遅延から対象駅の到着残分を求めます。
- 近鉄の静的時刻表との照合が成立しない場合に限り、列車位置だけの軽量推定へfallbackします。

## 運賃

確認日: 2026-10-10。

- 京都市バス: 均一区間 大人230円
- 京都市営地下鉄: 220 / 260 / 290 / 330 / 360円
- 近鉄: 2026年3月14日適用の普通旅客運賃表を営業キロに適用
- 京都バス: 公式普通旅客運賃表で40・特40の国際会館駅前—京都産業大学前—市原が全区間均一230円であることを確認。未確認の臨時区間は金額を作らない

出典URLと確認日は `public/js/fares.js` の `FARE_SOURCES` に保持します。定期券は設定画面で明示的に有効化した場合だけ追加額へ適用します。初期状態はすべて無効です。

## 曜日・祝日・臨時ダイヤ

GTFS事業者は `calendar.txt` と `calendar_dates.txt` から検索日そのものを判定します。京都バスの大学ダイヤと、GTFSを使わない近鉄・地下鉄fallbackについては `worker/service-calendar.js` の確認済み期間を使用します。確認済み範囲外を勝手に平日とみなしません。

## HTML構造変更時の扱い

市バス/近鉄の公式画面で目的要素が見つからない、または通常運行時間帯に件数が0になる場合は `layout_changed` として扱います。

- 直近成功値があれば予測へ切替
- 診断をKVへ保存
- アプリの隠しログへ source / freshness / error を記録
- 取得失敗を「運行なし」と解釈しない

## 開発・テスト

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
npx wrangler deploy --dry-run --config worker/wrangler.jsonc
```

主なテスト:

- GTFS ZIP/CSV解析
- 有効版・臨時版選択
- `calendar_dates` 優先
- 地下鉄公式時刻表fallbackの全線照合・失敗判定
- ODPT固有駅IDから内部 `Kxx` IDへの正規化
- 地下鉄の実駅時刻を使う乗車候補・駅間位置補間
- 近鉄公式全駅発車表の `tx` 結合・終着時刻導出条件
- 近鉄の列車位置＋静的時刻表＋遅延による到着残分照合
- 経路探索、到着時刻指定、乗換余裕、徒歩上限、列車種別
- 運賃と定期券
- 祝日判定
- 京都↔高の原などの公式発着時刻照合
- 公式HTML構造変更時の予測フォールバック

`ODPT_CONSUMER_KEY` はWorker secretとして登録し、ソース・公開HTML・KV値へ書き込みません。トークンが未設定の環境では、ODPT GTFSと京都バスGTFS-RTの実取得は行えません。

## 実機確認

1. iPhone Safariで公開URLを開き、時刻表タブ→経路検索を開く。
2. 出発/到着を入力し、出発指定と到着指定の両方を試す。
3. 検索条件で普通のみ/急行のみ、乗換余裕、徒歩上限を変更し結果が変わることを確認。
4. 「早い」「安い」「乗換少」のカードで時刻が逆転せず、区間タイムラインと運賃が表示されることを確認。
5. 設定→定期券をOFFのまま検索し、通常運賃と追加額が同額であることを確認。対象定期をONにして対象区間のみ追加額が変わることを確認。
6. 今タブで位置情報を許可し、接近情報が表示中だけ約15秒間隔で更新されることを確認。
7. 30〜60秒バックグラウンドへ移し、復帰時に即時更新されることを確認。
8. 機内モードで直近値/予測へ切り替わり、復帰後に実測へ戻ることを確認。
9. 設定→情報の見出しを7回タップし、隠しログのsource/freshness/errorを確認。
10. Safariの共有→ホーム画面に追加し、PWAで同じ検索、定期設定、バックグラウンド復帰を再確認。
