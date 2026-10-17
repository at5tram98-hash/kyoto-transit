# SmartLive 1〜75 再監査・継続実装記録

2026-10-17 / at5tram98-hash/kyoto-transit / main。前回観測値は報告値として保存し、現行コードを再確認した。旧Workの78節UI仕様表とは番号体系が異なる。

**✅はコード実装・自動検証対象の充足、🟡は外部データの制約が残る項目。全75項目とも実車・実機の精度は未検証。CI成功を現地の完成判定へ置換しない。**

現在は検証中であり未公開。確定したcommit/run/production版と検証結果は公開確認後に追記する。

| # | 項目 | 前回報告 | 今回実装 | コード根拠・実装範囲 |
|---:|---|:---:|:---:|---|
| 1 | 判定セッション状態 | 🟡 | ✅ | [ride-detection-session.js](../public/js/ride-detection-session.js#L8) — idle/candidate/confirming/riding/contradicting/rechecking/alighting とRail/Bus/Noneを単一セッションで管理。 |
| 2 | 現在地・速度・方向・加速度・マイク | ✅ | ✅ | [motion-assist.js](../public/js/motion-assist.js#L119) — 姿勢非依存の加速度大きさ、GPS速度の符号付き加速度、減速停止・停止発車Pattern。実センサー/音声APIの可用性はOS依存。 |
| 3 | 生センサーのEvidence化 | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L62) — 候補×sourceの最新1票、TTL、direction、context、margin、複数実観測を確認。Audio単独・歩行・単なるGPS＋振動を確定しない。 |
| 4 | 周辺交通候補生成 | ✅ | ✅ | [vnext-detect.js](../public/js/vnext-detect.js#L460) — 時刻表/直前駅/音声/選択旅程で候補を生成。再確認時はRail/Busと現Rideを同じPoolで評価。GPS時刻以外のEvidenceイベントでも進行。 |
| 5 | 直前位置・駅Context | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L101) — 直前駅を期限付きで保持し、停車/GPS欠損だけで候補を消さない。 |
| 6 | 10秒間の実移動方向 | ✅ | ✅ | [smartlive-evidence.js](../public/js/smartlive-evidence.js#L42) — 約10秒の実移動、精度/距離/時間でGPS揺れを除外。端末コンパスを進行方向と見なさない。 |
| 7 | 候補の進行方向との照合 | ✅ | ✅ | [smartlive-evidence.js](../public/js/smartlive-evidence.js#L42) — 約10秒の実移動、精度/距離/時間でGPS揺れを除外。端末コンパスを進行方向と見なさない。 |
| 8 | 速度の単純Hard Gateを回避 | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L101) — 直前駅を期限付きで保持し、停車/GPS欠損だけで候補を消さない。 |
| 9 | 加速・減速・停止Pattern | 🟡 | ✅ | [motion-assist.js](../public/js/motion-assist.js#L119) — 姿勢非依存の加速度大きさ、GPS速度の符号付き加速度、減速停止・停止発車Pattern。実センサー/音声APIの可用性はOS依存。 |
| 10 | 姿勢に依存しにくい加速度 | ✅ | ✅ | [motion-assist.js](../public/js/motion-assist.js#L119) — 姿勢非依存の加速度大きさ、GPS速度の符号付き加速度、減速停止・停止発車Pattern。実センサー/音声APIの可用性はOS依存。 |
| 11 | 時刻表の乗車候補 | ✅ | ✅ | [vnext-detect.js](../public/js/vnext-detect.js#L460) — 時刻表/直前駅/音声/選択旅程で候補を生成。再確認時はRail/Busと現Rideを同じPoolで評価。GPS時刻以外のEvidenceイベントでも進行。 |
| 12 | Realtime照合 | 🟡 | 🟡 | [realtime-evidence.js](../public/js/realtime-evidence.js#L15) — 共通adapterは実装済み。便/車両IDのない事業者データから完全な便照合は作れない。京都バスODPT本番認証は外部設定待ち。 |
| 13 | 候補生成前の許可済みマイク | ✅ | ✅ | [audio-window.js](../public/js/audio-window.js#L11) — 既許可を確認し、前候補/乗車後で排他的な最大6秒Window。新規許可要求・常時録音なし。 |
| 14 | 短時間Audio Window | ✅ | ✅ | [audio-window.js](../public/js/audio-window.js#L11) — 既許可を確認し、前候補/乗車後で排他的な最大6秒Window。新規許可要求・常時録音なし。 |
| 15 | 音声の構造化 | ✅ | ✅ | [announcement-parser.js](../public/js/announcement-parser.js#L8) — 路線/系統/行先/次駅/種別、既存alias・英語名・主要駅の読みを処理。単なる駅名言及では一致しない。実車認識精度は未検証。 |
| 16 | アナウンス語彙 | 🟡 | ✅ | [announcement-parser.js](../public/js/announcement-parser.js#L8) — 路線/系統/行先/次駅/種別、既存alias・英語名・主要駅の読みを処理。単なる駅名言及では一致しない。実車認識精度は未検証。 |
| 17 | 駅名・別名正規化 | 🟡 | ✅ | [announcement-parser.js](../public/js/announcement-parser.js#L8) — 路線/系統/行先/次駅/種別、既存alias・英語名・主要駅の読みを処理。単なる駅名言及では一致しない。実車認識精度は未検証。 |
| 18 | 強いAudio Evidence | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L62) — 候補×sourceの最新1票、TTL、direction、context、margin、複数実観測を確認。Audio単独・歩行・単なるGPS＋振動を確定しない。 |
| 19 | Audio単独確定禁止 | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L62) — 候補×sourceの最新1票、TTL、direction、context、margin、複数実観測を確認。Audio単独・歩行・単なるGPS＋振動を確定しない。 |
| 20 | Rail・Bus・Noneの明示Mode | 🟡 | ✅ | [ride-detection-session.js](../public/js/ride-detection-session.js#L8) — idle/candidate/confirming/riding/contradicting/rechecking/alighting とRail/Bus/Noneを単一セッションで管理。 |
| 21 | Rail路線 | ✅ | ✅ | [vnext-detect.js](../public/js/vnext-detect.js#L460) — 時刻表/直前駅/音声/選択旅程で候補を生成。再確認時はRail/Busと現Rideを同じPoolで評価。GPS時刻以外のEvidenceイベントでも進行。 |
| 22 | Rail方向 | ✅ | ✅ | [vnext-detect.js](../public/js/vnext-detect.js#L460) — 時刻表/直前駅/音声/選択旅程で候補を生成。再確認時はRail/Busと現Rideを同じPoolで評価。GPS時刻以外のEvidenceイベントでも進行。 |
| 23 | Rail便候補 | ✅ | ✅ | [vnext-detect.js](../public/js/vnext-detect.js#L460) — 時刻表/直前駅/音声/選択旅程で候補を生成。再確認時はRail/Busと現Rideを同じPoolで評価。GPS時刻以外のEvidenceイベントでも進行。 |
| 24 | 地下鉄・近鉄直通 | ✅ | ✅ | [now-model.js](../public/js/now-model.js#L45) — 既存直通Journey/駅コード境界を維持。新Audio SequenceもK15→B06を継続できる。 |
| 25 | Bus系統 | ✅ | ✅ | [vnext-detect.js](../public/js/vnext-detect.js#L460) — 時刻表/直前駅/音声/選択旅程で候補を生成。再確認時はRail/Busと現Rideを同じPoolで評価。GPS時刻以外のEvidenceイベントでも進行。 |
| 26 | Bus複合Identity | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L13) — operator/route/servicePattern/direction/destinationまたはheadsign/tripId/serviceDateの複合キー。Pool統合・確定候補選択でも使用。 |
| 27 | Bus方向と停留所Trail | ✅ | ✅ | [vnext-detect.js](../public/js/vnext-detect.js#L460) — 時刻表/直前駅/音声/選択旅程で候補を生成。再確認時はRail/Busと現Rideを同じPoolで評価。GPS時刻以外のEvidenceイベントでも進行。 |
| 28 | 循環路線 | ✅ | ✅ | [vnext-core.js](../public/js/vnext-core.js#L396) — 循環の停留所順とwrapを検証し、現在停留所から一周を保持。途中時刻の生成なし。 |
| 29 | Bus Audio行先 | 🟡 | ✅ | [announcement-parser.js](../public/js/announcement-parser.js#L8) — 路線/系統/行先/次駅/種別、既存alias・英語名・主要駅の読みを処理。単なる駅名言及では一致しない。実車認識精度は未検証。 |
| 30 | Bus車両単位Realtime照合 | 🟡 | 🟡 | [realtime-evidence.js](../public/js/realtime-evidence.js#L15) — 共通adapterは実装済み。便/車両IDのない事業者データから完全な便照合は作れない。京都バスODPT本番認証は外部設定待ち。 |
| 31 | Confidence | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L62) — 候補×sourceの最新1票、TTL、direction、context、margin、複数実観測を確認。Audio単独・歩行・単なるGPS＋振動を確定しない。 |
| 32 | 判定段階UI | 🟡 | ✅ | [vnext-view.js](../public/js/vnext-view.js#L390) — 確認/確定/再確認と、Modeだけ分かるshellを表示。疑わしい系統/行先を主表示として断定しない。PWA reloadもshellを維持。 |
| 33 | Top候補とのMargin | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L62) — 候補×sourceの最新1票、TTL、direction、context、margin、複数実観測を確認。Audio単独・歩行・単なるGPS＋振動を確定しない。 |
| 34 | 複数Evidence | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L62) — 候補×sourceの最新1票、TTL、direction、context、margin、複数実観測を確認。Audio単独・歩行・単なるGPS＋振動を確定しない。 |
| 35 | 確定後の継続検証 | ✅ | ✅ | [smartlive-supervisor.js](../public/js/smartlive-supervisor.js#L489) — 継続検証とprovider更新のadapter評価。矛盾時30秒だけ再評価4秒/Realtime8秒、通常は既存周期/キャッシュを利用。GPSのOS配信頻度は強制しない。 |
| 36 | Hysteresis | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L62) — 候補×sourceの最新1票、TTL、direction、context、margin、複数実観測を確認。Audio単独・歩行・単なるGPS＋振動を確定しない。 |
| 37 | 便変更に強い根拠 | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L62) — 候補×sourceの最新1票、TTL、direction、context、margin、複数実観測を確認。Audio単独・歩行・単なるGPS＋振動を確定しない。 |
| 38 | 現在駅 | 🟡 | ✅ | [ride-detection-session.js](../public/js/ride-detection-session.js#L186) — 現在駅/停車/発車/降車候補のセッション遷移。観測なしはunknownとし、時刻だけで停車/降車を確定しない。 |
| 39 | 停車 | 🟡 | ✅ | [ride-detection-session.js](../public/js/ride-detection-session.js#L186) — 現在駅/停車/発車/降車候補のセッション遷移。観測なしはunknownとし、時刻だけで停車/降車を確定しない。 |
| 40 | 発車 | 🟡 | ✅ | [ride-detection-session.js](../public/js/ride-detection-session.js#L186) — 現在駅/停車/発車/降車候補のセッション遷移。観測なしはunknownとし、時刻だけで停車/降車を確定しない。 |
| 41 | 降車候補 | 🟡 | ✅ | [ride-detection-session.js](../public/js/ride-detection-session.js#L186) — 現在駅/停車/発車/降車候補のセッション遷移。観測なしはunknownとし、時刻だけで停車/降車を確定しない。 |
| 42 | 降車確定 | ✅ | ✅ | [vnext-detect.js](../public/js/vnext-detect.js#L365) — 既存の継続した到着観測と明示降車を維持。乗換は全Journeyを保持。誤乗車解除ではLegを進めない。 |
| 43 | 乗換でJourneyを終了しない | ✅ | ✅ | [vnext-detect.js](../public/js/vnext-detect.js#L365) — 既存の継続した到着観測と明示降車を維持。乗換は全Journeyを保持。誤乗車解除ではLegを進めない。 |
| 44 | 乗車後Audio | ✅ | ✅ | [motion-assist.js](../public/js/motion-assist.js#L387) — 乗車後も既許可・短時間の認識を再利用。非表示/設定OFF/pagehideでabortし、遅れて来た結果も無効化。 |
| 45 | Audio駅順Sequence | 🟡 | ✅ | [ride-detection-session.js](../public/js/ride-detection-session.js#L227) — 次駅の隣接順/逆順/反復を検証。循環wrapと直通境界に対応し、音声生データを履歴へ残さない。 |
| 46 | 音声誤認防止 | ✅ | ✅ | [announcement-parser.js](../public/js/announcement-parser.js#L8) — 路線/系統/行先/次駅/種別、既存alias・英語名・主要駅の読みを処理。単なる駅名言及では一致しない。実車認識精度は未検証。 |
| 47 | Evidence TTL | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L62) — 候補×sourceの最新1票、TTL、direction、context、margin、複数実観測を確認。Audio単独・歩行・単なるGPS＋振動を確定しない。 |
| 48 | Evidence品質 | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L62) — 候補×sourceの最新1票、TTL、direction、context、margin、複数実観測を確認。Audio単独・歩行・単なるGPS＋振動を確定しない。 |
| 49 | Mode判定・便不明UI | 🟡 | ✅ | [vnext-view.js](../public/js/vnext-view.js#L390) — 確認/確定/再確認と、Modeだけ分かるshellを表示。疑わしい系統/行先を主表示として断定しない。PWA reloadもshellを維持。 |
| 50 | 複数Evidenceで最終確定 | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L62) — 候補×sourceの最新1票、TTL、direction、context、margin、複数実観測を確認。Audio単独・歩行・単なるGPS＋振動を確定しない。 |
| 51 | 確定後もEngine継続 | ✅ | ✅ | [smartlive-supervisor.js](../public/js/smartlive-supervisor.js#L489) — 継続検証とprovider更新のadapter評価。矛盾時30秒だけ再評価4秒/Realtime8秒、通常は既存周期/キャッシュを利用。GPSのOS配信頻度は強制しない。 |
| 52 | 明示的5段階状態 | 🟡 | ✅ | [ride-detection-session.js](../public/js/ride-detection-session.js#L8) — idle/candidate/confirming/riding/contradicting/rechecking/alighting とRail/Bus/Noneを単一セッションで管理。 |
| 53 | Expected State | 🟡 | ✅ | [ride-detection-session.js](../public/js/ride-detection-session.js#L166) — Mode・方向・次駅・その次・予定到着のExpected Stateと、Audio/方向/Trail/Realtimeの矛盾を追跡。 |
| 54 | Expectedと実Evidenceの比較 | ✅ | ✅ | [ride-detection-session.js](../public/js/ride-detection-session.js#L166) — Mode・方向・次駅・その次・予定到着のExpected Stateと、Audio/方向/Trail/Realtimeの矛盾を追跡。 |
| 55 | Contradiction Scoreと根拠 | 🟡 | ✅ | [ride-detection-session.js](../public/js/ride-detection-session.js#L275) — source別0–100矛盾scoreとEvent履歴。GPS由来のdirection/patternは同じfamily。重複signatureを水増ししない。 |
| 56 | 単発異常で便変更しない | ✅ | ✅ | [ride-detection-session.js](../public/js/ride-detection-session.js#L275) — source別0–100矛盾scoreとEvent履歴。GPS由来のdirection/patternは同じfamily。重複signatureを水増ししない。 |
| 57 | 矛盾時の取得強化 | 🟡 | ✅ | [smartlive-supervisor.js](../public/js/smartlive-supervisor.js#L489) — 継続検証とprovider更新のadapter評価。矛盾時30秒だけ再評価4秒/Realtime8秒、通常は既存周期/キャッシュを利用。GPSのOS配信頻度は強制しない。 |
| 58 | 再確認中のRide shell | ❌ | ✅ | [vnext-view.js](../public/js/vnext-view.js#L390) — 確認/確定/再確認と、Modeだけ分かるshellを表示。疑わしい系統/行先を主表示として断定しない。PWA reloadもshellを維持。 |
| 59 | 現Rideを含めPool再ランキング | 🟡 | ✅ | [vnext-detect.js](../public/js/vnext-detect.js#L460) — 時刻表/直前駅/音声/選択旅程で候補を生成。再確認時はRail/Busと現Rideを同じPoolで評価。GPS時刻以外のEvidenceイベントでも進行。 |
| 60 | 別便への自動修正 | ✅ | ✅ | [vnext-detect.js](../public/js/vnext-detect.js#L460) — 時刻表/直前駅/音声/選択旅程で候補を生成。再確認時はRail/Busと現Rideを同じPoolで評価。GPS時刻以外のEvidenceイベントでも進行。 |
| 61 | Journeyを保持してRide修正 | ✅ | ✅ | [vnext-detect.js](../public/js/vnext-detect.js#L319) — 自動修正時はJourney/id/目的地を保持してRideを更新。完了Toastは修正時のみ。 |
| 62 | 修正完了の通知 | 🟡 | ✅ | [vnext-detect.js](../public/js/vnext-detect.js#L319) — 自動修正時はJourney/id/目的地を保持してRideを更新。完了Toastは修正時のみ。 |
| 63 | 正解不明時の便確認中 | ✅ | ✅ | [vnext-view.js](../public/js/vnext-view.js#L390) — 確認/確定/再確認と、Modeだけ分かるshellを表示。疑わしい系統/行先を主表示として断定しない。PWA reloadもshellを維持。 |
| 64 | Bus・Railの再分類 | ✅ | ✅ | [vnext-detect.js](../public/js/vnext-detect.js#L460) — 時刻表/直前駅/音声/選択旅程で候補を生成。再確認時はRail/Busと現Rideを同じPoolで評価。GPS時刻以外のEvidenceイベントでも進行。 |
| 65 | 未乗車へ復帰 | ✅ | ✅ | [vnext-detect.js](../public/js/vnext-detect.js#L406) — 複数sourceの矛盾＋候補路線からの離脱＋センサーで確認した歩行を45秒継続した場合、または明示操作で未乗車へ。旅程を進めず準備状態へ戻す。 |
| 66 | 停留所順の継続検証 | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L25) — 直近Trailの順序、方向、循環wrapを確認。反対周り/逆順の候補を除外する。 |
| 67 | 連続Audio駅順検証 | 🟡 | ✅ | [ride-detection-session.js](../public/js/ride-detection-session.js#L227) — 次駅の隣接順/逆順/反復を検証。循環wrapと直通境界に対応し、音声生データを履歴へ残さない。 |
| 68 | GPS方向ノイズ対策 | ✅ | ✅ | [smartlive-evidence.js](../public/js/smartlive-evidence.js#L42) — 約10秒の実移動、精度/距離/時間でGPS揺れを除外。端末コンパスを進行方向と見なさない。 |
| 69 | 次停留所で反対周り検出 | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L25) — 直近Trailの順序、方向、循環wrapを確認。反対周り/逆順の候補を除外する。 |
| 70 | 共通Correction Lock | 🟡 | ✅ | [ride-detection-session.js](../public/js/ride-detection-session.js#L150) — 旧/新の復旧経路を共通化。修正後45秒は前候補への復帰に3source・90以上を要求。 |
| 71 | Confidence Decay | ✅ | ✅ | [transit-evidence.js](../public/js/transit-evidence.js#L128) — source品質を経過時間で減衰し、期限後は0。Unavailableを矛盾へ変換しない。 |
| 72 | Realtime更新ごとの再検証 | 🟡 | ✅ | [smartlive-supervisor.js](../public/js/smartlive-supervisor.js#L489) — 継続検証とprovider更新のadapter評価。矛盾時30秒だけ再評価4秒/Realtime8秒、通常は既存周期/キャッシュを利用。GPSのOS配信頻度は強制しない。 |
| 73 | データなしと矛盾の分離 | ✅ | ✅ | [realtime-evidence.js](../public/js/realtime-evidence.js#L33) — Unavailable/neutral/supportive/contradictoryを区別。通信断/古いデータ/無関係な車両は矛盾にしない。 |
| 74 | 今の便を修正 | 🟡 | ✅ | [vnext.js](../public/js/vnext.js#L197) — 控えめな修正導線から既存候補選択へ。明示の「乗車していません」も用意し、自動補正を主とする。 |
| 75 | Privacy-safe診断履歴 | 🟡 | ✅ | [ride-detection-session.js](../public/js/ride-detection-session.js#L336) — メモリ内最大100件、時刻・種別・score・状態遷移・一時aliasのみ。座標/音声/駅名/便IDを診断履歴に残さず送信しない。 |

## UI/UX 18項目

| # | 状況 | 実装・確認箇所 |
|---:|:---:|---|
| 1 | ✅ | Live専用ダッシュボードと独立Search。live-home.js / route-search-ui.js |
| 2 | ✅ | Liveの検索/保存/定期を分離。定期はその他の既存設定 |
| 3 | ✅ | Date fit、Filter fit、既存medium/largeを維持。navigation.js / vnext-sheets.css |
| 4 | ✅ | 日時の適用・取消を単一検索モデルへ反映。今回Historyとの非同期競合を修正 |
| 5 | ✅ | 既存routerで出発/到着/始発/終電/交通機関/徒歩条件を計算。未対応データをUIで捏造しない |
| 6 | ✅ | 最近/保存/周辺/駅/停留所/対応地点。今回駅と停留所のグループを分離 |
| 7 | ✅ | 中央時刻と小さい前後便、早/楽/安、路線色。既存v3/Journey検査で維持 |
| 8 | ✅ | 既存Vertical Railと乗換/便変更のactionを維持 |
| 9 | ✅ | 日本語主CTAを「この経路で案内を開始」へ統一 |
| 10 | ✅ | 既存接近compact/展開、系統・方面・ETA・停留所数・sourceを維持 |
| 11 | ✅ | Realtimeなしでは既存official schedule fallback。未取得時刻を作らない |
| 12 | ✅ | 同じ名称・180m以内の交通地点を表示上グループ化し、operator別stop IDとactionを保持 |
| 13 | ✅ | 既存運行影響/保存路線/回避検索。最新便選択まではJourneyを置換しない |
| 14 | ✅ | 既存交通機関semantic tokenを維持 |
| 15 | ✅ | 既存solid contentとmaterial navigationを維持。新規patch CSSファイルなし |
| 16 | ✅ | routine tab切替にhapticなし。既存明示アクションのhapticを維持 |
| 17 | ✅ | LiveタイトルとMyMap subtitleを維持し、旧「現在地に合わせて周辺案内」への回帰なし |
| 18 | ✅ | 検索入力/条件/結果は既存Plannerの一所有。Sheetのcommit/restoreをHistory保存前へ統合 |

## 中断Workからの継続範囲

既存「kyoto-transit をセットアップ」（01a128e0-ea82-74e3-bd8e-6f25cbfcd0b0）の直近失敗ターンを確認。英語レイアウト/CTA検査修正はmainにマージ済みだったため再実装していない。中断していた本番API・旧PWA更新・Offline保持の実接続確認は今回の公開版で取り直す。

Phase 0でgit fetch/pullを実行し、main=70004fe、Pages #265のChromium候補選択timeout、WebKit/PWA成功・deploy/postdeploy未実行を確認。本番の開始時SW版はa7dd480ddd98。

## 未検証・外部制約

- 京都バスODPTの有効な本番認証と便/車両IDの供給粒度。無効keyを登録せず、公式時刻表fallbackを維持。
- iPhoneの実Safari/PWA、VoiceOver、OS Dynamic Type、edge gesture、safe area、画面OFF/復帰時のセンサー/音声。
- 地下鉄/近鉄両方向・直通を合計5回以上、市バス循環/双方向を合計5回以上。60秒以内検出、誤方向/誤便0の実績は未測定。
- Web SpeechとMotion APIの可用性・精度・電池負荷は実機条件に依存。取得頻度をOSへ強制しない。

Global Release Ready は NO。検証前の未達を成功と書かず、公開後の結果を以下へ追記する。
