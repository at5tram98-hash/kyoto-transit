# Yahoo!乗換案内の画面・操作への整合

2026-10-15。最新ユーザー指示「今の画面とか、経路がでる画面はyahoo乗り換えアプリのと全く同じ操作方法、そして全く同じ画面」「機能を削ぎ落とさず」を優先する。main `aac0ddb` / 公開build `391a94d777da` を基準とする。直前のPages CI `38588396129` はWebKit/Chromium/公開まで成功しており、停止要求の時点で公開済みだった。

## 変更前と新しい画面構造

- 今の未乗車Homeは目的地入口だけ。検索は別Tabの単一フォーム。結果は丸いcard、詳細は保存行＋Journey Rail＋下部CTA。
- 新HomeはYahoo公式2026年の右側の新画面を参照し、上部のルート／最寄り切替、出発、経由・入替、到着、日時、条件、検索の順とする。
- Homeの発着は共有検索Controllerを直接開くbutton。検索条件を別Storeや別formへ複製しない。候補・日時・条件Sheetは一つの所有者で再利用し、今のStackから結果・詳細へPushする。
- 結果は発着の要約、中央日時と左右の1本前後、早・楽・安、番号付きの候補List。全行tapで詳細。
- 詳細は時刻・運賃・乗換の要約→保存・画像・共有・運行・案内の操作列→発着駅の帯と時刻・路線の縦列。取得済み番線・途中駅・接続・別便変更・定期を残す。
- 既存の乗車Hero、全停車駅、北3、直通K/B、折返し、Realtime、遅延、保存、設定、時刻表、Navigation Stack、PWAを保持する。

## 参照と境界

公式紹介 `https://transit.yahoo.co.jp/promo/app/`、公式2025/08/21詳細更新、公式2026/09/15 Liquid Glass更新の画像を使用。2026年Home/detailの新画面を優先する。取得原本は `/workspace/artifacts/mymap-yahoo-alignment-2026-10-15/references/`。競合の実機タップ座標や全バージョンを測定したという意味ではない。

IC残高、座席指定、乗車位置／出口、運行Push等の取得していない機能を、動かないbuttonとして追加しない。対応する位置にはMyMapの実際の条件・定期・運行・案内を配置する。アプリ名・ロゴはMyMapのまま。

## 検証

390×844、Light/Dark、文字100/150/200%、Reduce Motion、GPS ON/OFF。Home直接入力→結果→詳細→別便→後続再計算→案内、検索Tabとの入力共有、日時取消／適用、App/Browser/Swipe Backと独立scrollを検証する。既存340モデル、34画面座標、全ブラウザー・PWA回帰を維持し、Before/Afterと残存差を記録する。

## 画面ごとの比較と修正

|画面|Yahoo公式画像で確認した配置／操作|MyMapの変更と継続機能|
|---|---|---|
|今・未乗車|ルート／最寄の切替、緑の発着label、入替・現在地、日時・条件、橙色検索|同じ順に直接操作。候補は既存Fullscreen editor。経由・履歴・定期も残す|
|検索結果|中央日時と1本前後、早・楽・安、番号付き一覧|日時tapで取消／適用、同深さの再検索。発着行tapで条件編集。候補全行tap|
|経路詳細|要約→丸い操作列→灰色駅帯・時刻・交通色の縦列|保存・経路PNG・共有・運行・案内。出発時刻tapで実便選択、駅tapで地点詳細|
|途中駅|路線の左側に駅数の展開ボタン|取得済みpathと途中駅時刻を表示、開閉を保持|
|乗車中・高度機能|公式画面の外観を参照しつつ既存交通の専用情報が必要|既存Hero・降車・列車位置・折返し・遅延・地図への階層を保持|

検索Controllerは共通、DOM所有者はSearch Tabの一つのform。Homeは値の表示と同じController呼出しだけを担当する。既存Navigation Stack／History／focus／scrollの機構を再利用し、独自の別Stackや検索Storeを追加していない。

## 実装ファイル

- `public/js/route-search-home.js`：Home入口View。`route-search-ui.js`：共有Controller、日時取消／適用、結果・詳細のイベント。
- `public/js/route-search-view.js`：番号付き候補、操作列、駅帯・途中駅の経路描画。`route-image.js`：選択経路モデルからPNG生成。
- `public/js/vnext-view.js`、`vnext.js`：Home所有と状態連携。`now-navigation.js`：Now内部buttonだけを対象にして二重Pushを防止。`vnext-state.js`：共通SVG。
- `route-search.css`、`idle-experience.css`、`vnext-navigation.css`、`vnext-ui.css`、`vnext.css`：owner CSSとsemantic色。`stability.css`：旧card上書き削除。`interaction-guard.css`：未使用旧入口CSS削除。
- `scripts/yahoo-browser-checks.mjs`：新しい直接検索・日付取消／適用・戻り・PNG・駅詳細。既存ブラウザー/PWA/34画面監査は現行画面のselectorへ更新し、44px/8px基準を維持。

## Before / After

390×844、Light、100%。Beforeは公開済みbuild `391a94d777da` のCI、Afterは同じ上流fixtureを使うローカル実ブラウザー。競合画像とのピクセル一致率を測定したものではない。

|画面|Before|After|
|---|---|---|
|今|[画像](evidence/yahoo-2026-10-15/before-now-home.png)|[画像](evidence/yahoo-2026-10-15/after-now-home.png)|
|結果|[画像](evidence/yahoo-2026-10-15/before-search-results.png)|[画像](evidence/yahoo-2026-10-15/after-search-results.png)|
|詳細|[画像](evidence/yahoo-2026-10-15/before-route-detail.png)|[画像](evidence/yahoo-2026-10-15/after-route-detail.png)|

## 確認できた差と限界

Yahoo公式画像を基準に配置と意味を合わせる。MyMapの既存交通機能を維持するため、操作列の内容、乗車Hero、取得可能な交通データはMyMapの実機能を使う。YahooのIC残高・指定席購入・出口／車両位置等を実装済みとは扱わない。Google Mapsの一般住所／POI検索、OS統合、Yahooの独自Push、物理iPhoneのSafari端ジェスチャー・VoiceOver・hapticは別途実測・データ連携が必要。

34画面の座標検査の合格と、競合全機能同等・全画面ピクセル一致の100%は別の評価である。


## 検証記録

対象runtime build `29042e3e28c7`。構文・公開残骸check、モデル340件、PWA9項目は成功。新Home直接検索→結果→詳細、日時取消／適用、PNG実出力、駅詳細／戻る、TabのStack／入力共有は390px・Light/Dark・100/150/200%で確認。

34画面×8条件の座標監査は [集計JSON](evidence/yahoo-2026-10-15/coordinates-summary.json)：最小target44px、独立action間隔8px、collision0／textOverflow0。最終sourceに対して再取得する全回帰の正式な合否は [Pages公開workflow](https://github.com/at5tram98-hash/kyoto-transit/actions/workflows/pages.yml) のWebKit・Chromium・PWA・実地理・公開9項目に基づく。途中失敗を消して成功として数えない。

試験で発見した問題：Nowのclickが祖先shellのscreen属性を拾って結果を二重Push、sortの子spanがclick対象から外れる、200%で入替記号が44px枠からはみ出す、旧小画面CSSで結果がcardに戻る、経路全体のsourceラベルが抜ける。いずれもController／owner CSS／既存の描画箇所で修正した。

送信前のHome入力を選択直後に再読み込みする試験を追加し、消失を再現した。候補確定、日時／条件Sheetを閉じた時に同じ検索ModelをNavigation memoryへ保存して修正。入力保持を含まない初回CI `38667212238` は公開前に取り消し、修正版で全試験を再実行する。座標272状態の幾何は直前のUI build `1223bfaee6ba` と同じ（追加修正はModel保存のみ）。
