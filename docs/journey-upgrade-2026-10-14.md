# 経路・接近・乗車案内の連携設計

基準: main `6dbe536`、公開アプリ `d054dc9865ae`。ユーザー提供の34画面レポートを改修要求として読み、過去の検証結果・評価点は現在の実装の証拠と分ける。KV quota対策のentry/環境wrapperは最新版に存在し、維持する。

## 画面と操作

既存の今／時刻表／運行情報／設定とNavigation Stackを使用する。経路詳細→「発車時刻」→便選択（Push）→再計算のプレビュー→確定→同じ経路詳細へ戻る。キャンセル、Tab、Browser Back、Swipe Backで原本・入力・scrollを維持する。詳細地図、降車設定Sheet、折返しは維持。

|対象|変更|
|---|---|
|経路詳細|左に時刻、中央に路線・ノード、右に地点・路線・方面。到着と次便発車、徒歩、待ち、滞在を連続表示。途中駅・番線・source・運賃・定期・保存・共有・案内を残す|
|便選択|同じ交通機関・区間・方向の公式便。急行通過、運行日、24:xx、経由滞在、接続不可、古いダイヤ、未取得、取消を扱う。時刻だけ変えない|
|検索結果|1本前と次の出発を区間便選択と分ける。既存3経由・sort・条件変更を維持|
|接近|系統・行先・到着が第一階層、のりば・混雑・遅れが第二階層、source/各行更新時刻が第三階層。位置図と1停留所前アニメーションを維持|
|停留所詳細|既知の路線chip、次便2〜3件、すべての接近情報。未取得のminutesを停留所数から生成しない|
|旅程と乗車|検索した全Legを保持し、現在区間・降車地点・徒歩／乗換・次便を案内。次便への実乗車は明示操作または既存の検証済み自動判定に従う|
|関連UI|地点候補の事業者・路線・駅番号、経由と滞在、停車状態、定期適用、現在経路の運行、距離設定の実件数、情報出典を明確化|

## データと再計算

便をserviceId/tripId/運行日/from/toで識別し、Screenのrevisionと経路versionを照合する。前の区間を保持し、選択便へ間に合うことを検証。後続は既存routerの探索状態をseedとして再探索し、経由・滞在・乗換余裕・累積徒歩・全区間運賃を再計算する。元経路とプレビューを別オブジェクトにし、確定まで原本を変更しない。

交通時刻は検索基準日の絶対分で計算し、元の運行日をserviceDateに残す。必要な翌日のfeedを同じ時間軸へ変換する。表示番線は取得済みだけ。曖昧なRealtime照合やGPS推定を公式の便別実測と呼ばない。古い検索に遅れて届いた更新が編集中・確定済みの旅程を上書きしない。

## 所有ファイル

- `journey-plan.js`: 便候補、旅程の制約・再計算・保存モデル。既存router/faresを使用。
- `route-trip-screen.js`: 便選択画面の非同期処理・プレビュー・取消。document routerを増やさない。
- `route-search-ui.js` / `planner-worker.js`: snapshot、既存feedとWorkerの共有、経路確定。
- `route-search-view.js` / `route-search.css`: 連続した旅程と便選択の表示。
- `vnext-arrivals.js` / `view-rendering.js` / `vnext-arrivals.css`: 安定した接近行の階層と地点別コンパクト表示。
- `journey-session.js` / `vnext-state.js` / 既存乗車controller: 全旅程と既存の現在乗車の連携・復元。

画面cacheと選択中のrequestは有限。非表示画面でpollingを増やさず、次便の表示は既存の接近取得・cacheを共有する。GPS履歴を旅程保存に追加しない。

## 検証

新規の意味あるモデルテスト: 別便→後続便変更、接続不可、急行通過、会社違い、定期料金、経由滞在、日跨ぎ、運行日、古いrevision、取消、案内対象tripId、復元。

実ブラウザー: 検索→詳細→別便→確定→案内、乗換→次便、停留所コンパクト→全接近、1本前、戻る・Tab・reload保持。既存34画面と新画面の390px Light/Dark 100/150/200%、44px、8px以上の独立action間隔、CTAヒット、Reduce Motion、GPS、PWA、実タイルを確認する。最終結果とBefore/Afterは完了後に追記する。

始発/終電、POI、歩行速度、乗車位置、出口、障害回避、バリアフリーはデータの裏付けなしにUIだけ作らない。今回の改修を競合実機の完全コピーや全国対応と報告しない。

## 実装したUXとNavigation Map

```text
今 / 時刻表（独立した既存Stack）
  └ 検索 → 検索結果 → 経路詳細 → 便を変更 → プレビュー → 確定して経路詳細
                                  └ この経路を使う → 今 / 案内準備
今 / 乗車中
  ├ 次の行動 → 旅程（全区間）→ 降車 → 乗換準備 → 明示的に次便へ乗車
  ├ 停車駅・停留所 → 駅・停留所詳細 → 系統chipと接近2〜3便 → 全接近
  ├ 地図（既存Full Screen）
  ├ 列車位置・遅延・運行・折り返し（既存機能）
  └ 降車地点・通知（既存Sheet）
運行情報 → 事業者詳細
設定 → 定期 / 距離 / 路線 / 情報・出典
```

`#/now/departures/{encoded params}`、`#/now/journey`等を既存History APIに載せる。新しいNavigationを並立させず、共通Push / Pop / Interactive Swipeを使用する。便選択の親ラベルは「経路詳細」。App Back / Browser Back / Tab復帰 / 再読み込みは同じsnapshotを参照する。

初便変更後に後続便へ間に合わなければ、その先をrouterで再探索する。到着締切を超える変更はプレビューに明示する。別会社・急行通過・方向違い・経由滞在を壊す便・運行variant未確認・到着未取得は混ぜず、理由を表示する。番線は取得済みだけを「時刻表記載」と表示する。

曖昧なRealtimeで全Legへ同じ遅れを加える旧処理を廃止した。便／運行日と90秒以内の情報が一致すると対象tripを更新し後続便を再探索する。曖昧な照合は予定を維持して推定の着時刻・乗換危険を表示する。接続なしの全経路CTAは出さず、古いCTAからの確定もControllerで拒否する。

全旅程と現在乗車の保存を分離し、次の区間は実際に乗ったと確認するまで準備状態にする。最後に徒歩が残る場合は降車で旅程全体を完了扱いにしない。降車地点を元経路と異なる地点へ変更すると警告し、元の後続案内へ自動進行させない。折り返し・他の便へ乗車した場合も、無関係な旧旅程を引き継がない。

## 実装ファイル

|責務|ファイル|
|---|---|
|選便・再探索・全旅程モデル|`public/js/journey-plan.js`, `router.js`, `fares.js`, `search-core.js`, `planner-worker.js`|
|便選択Screen、snapshot、経路・旅程表示|`route-trip-screen.js`, `route-search-ui.js`, `route-search-view.js`, `route-search-model.js`|
|正しい運行日の乗車モデルと復元|`journey-session.js`, `vnext-state.js`, `vnext-detect.js`, `vnext.js`|
|停留所プレビュー、接近表示・更新|`bus-stop-preview.js`, `now-navigation.js`, `context-sheet.js`, `vnext-arrivals.js`, `arrival-stability.js`, `view-rendering.js`|
|次の行動・通過済み・運行優先・設定|`now-components.js`, `vnext-view.js`, `timetable-ui.js`, `vnext-network-view.js`|
|History keyの再利用防止|`navigation.js`, `navigation-core.js`|
|所有要素のCSS整理|`route-search.css`, `vnext-arrivals.css`, `vnext-journey.css`, `stability.css`|
|回帰テスト|`tests/journey-plan.test.js`, 既存モデルテスト、`scripts/journey-browser-checks.mjs`, `browser-smoke.mjs`|

探索・運賃の旧圧縮コードを同時に整形し、seed・運行日・sourceの責務を確認できるようにした。既存Realtime/GPS/折返し/北3/直通の仕組みとWorker quota対策を維持した。

## 座標とBefore / After

同じ34画面を390×844 Light/Dark 100/150/200%、805×844 Light/Darkで比較した。変更前272枚、変更後272枚と座標JSONがある。レイアウト・交通データはfixtureであり、運行精度の実測や競合実機の画像ではない。

390px Light 100%の経路詳細CTAはx=22 / y=710 / width=346 / height=50 / bottom=760。Tab top=781で21px離れ、中央のhit判定も成功。272状態でtarget44px、独立action gap8px、clipping0・collision0を確認した。

|画面|Before|After|
|---|---|---|
|経路詳細|[画像](screenshots/2026-10-14/before-route-detail-390-light-1.png)|[画像](screenshots/2026-10-14/after-route-detail-390-light-1.png)|
|接近|[画像](screenshots/2026-10-14/before-arrivals-390-light-1.png)|[画像](screenshots/2026-10-14/after-arrivals-390-light-1.png)|
|停留所詳細|[画像](screenshots/2026-10-14/before-bus-stop-detail-390-light-1.png)|[画像](screenshots/2026-10-14/after-bus-stop-detail-390-light-1.png)|
|運行情報|[画像](screenshots/2026-10-14/before-operations-390-light-1.png)|[画像](screenshots/2026-10-14/after-operations-390-light-1.png)|
|距離設定|[画像](screenshots/2026-10-14/before-settings-distance-390-light-1.png)|[画像](screenshots/2026-10-14/after-settings-distance-390-light-1.png)|

新画面: [便一覧](screenshots/2026-10-14/journey-choices-light-1.png) · [接続変更プレビュー](screenshots/2026-10-14/journey-preview-light-1.png) · [更新した経路](screenshots/2026-10-14/journey-updated-light-1.png) · [全旅程](screenshots/2026-10-14/journey-itinerary-light-1.png) · [乗換準備Dark 200%](screenshots/2026-10-14/journey-transfer-dark-2.png)。

全34画面の比較HTML・画像・座標は `/workspace/artifacts/mymap-journey-upgrade-2026-10-14/`。`screen-report.html`がローカルの閲覧入口。全体のテスト結果は下記、公開結果は公開確認後に追記する。

## 残存課題

競合実機の座標、iPhoneハードウェアのVoiceOver・Haptic・Safari OS Edge Backは未測定。WebKitの検証と実機確認を区別する。現在地・接近の予測だけで実乗車や降車を断定しない。

乗車後に将来Legを直接編集する再提案、変更した降車地点からの自動全旅程再計算、初期検索での深夜翌日接続coverageは次の段階。番線・便別実測の欠測、京都バスODPT未設定、POI/住所・入口/出口・乗車位置・始発/終電・歩行速度・バリアフリーのデータ整備も残る。取得していない値や対応をUIだけで作らない。

今回の変更と引継ぎは `docs/chatgpt-work-next-iteration-memory.md` に反映した。資料中の評価点や「100%」という表現を完成保証には用いない。


## 最終ローカル検証（build e4d70f519c99）

|検証|結果|
|---|---|
|構文・公開コード検査|`npm run check` 成功|
|全モデル・Worker・KV quota回帰|`npm test` 331件成功|
|公開ビルド|`npm run build` 成功、e4d70f519c99|
|Chromium全回帰|450 layout checks、アプリ例外0。新フロー54、既存検索・折返し・北3・直通・通知・保存・Offline等を含む|
|拡張座標|34画面×8状態=272。1636 targetsの最小44px、独立actionの最小gap8px、clipping0・collision0|
|Push / Pop / Swipe / History|Flow A–F成功。1:1追従、30%取消・50%確定・flick・PointerCancel、縦scroll/Map/Sheet/Tab競合、scroll/入力/zoom/Reload保持、cache上限を検証|
|Realtime性能|GPS10回で追加接近request0、20秒で1回更新、時刻以外が同じ行のdata-field/位置DOM更新0。sourceの取得時刻だけは更新しrow/markerを保持|
|PWA|9項目成功。更新待ち中の乗車・お気に入り保持、更新後復元、旧client、Offline、precache失敗、旧Worker migrationを検証。アプリ例外0|
|実地図|実際のOpenStreetMap PNGを取得し地理Mapとして描画。別suite202 layout checks、例外0|

Chromiumはクラウド環境の実ブラウザーで実行した。WebKitは公開CIで検証し、結果を公開確認と併せて記録する。iPhoneハードウェアは未実測。

旧テストの番線表記を「発 1のりば」に合わせ、先に検索結果が表示された段階でRealtime完了を仮定せず、8秒以内にloadingが消えることを待って無関係な警告がないか検証する。更新時刻だけの変更についてはsourceを許可し、車両・時刻・位置を再描画しないことと、各行の取得時刻の正しさを独立して検証する。
