# MyMap E工程 — 公開前最終検証 (2026-10-19)

## 判定

- **公開候補の実装・ビルド・PWA・自動UI品質: 合格。**
- **現行本番の主要運行API・公開ビルドの読取診断: 合格。**
- **全事業者実測・実機/実走の総合受入: 未達。Global Release Ready = NO。**
- **公開作業: 未実施。main未変更。**
- 候補は `chat/e-prepublication-audit-20261019`。D-6からの継承を維持する。

## E-1. 回帰

[D-6](https://github.com/at5tram98-hash/kyoto-transit/actions/runs/39159131514):
静的検査・モデル520件・ビルド・Chromium/WebKitの全画面操作・両エンジンでのPWA更新/オフライン検証がすべて成功。

## E-2. 配信候補の整合性

`node scripts/e-release-preflight.mjs`を `npm run build` 後に実行。
Service WorkerとHTMLの版一致、CSSリンク、ローカルJS importの同版参照、PWAメタデータ、配信物のすべてのオフラインキャッシュ対象を検査する。
E最初の候補のハッシュは `c13b519a58ef`（公開済みハッシュではない）。
配信ファイル113、JSモジュール94、CSS参照13、Service Workerのキャッシュ対象114。
Cloudflare Workerは `wrangler deploy --dry-run` のみ実施し、本番反映しない。

## E-3. 実サービス（現行本番のみ）

`npm run verify:production` を読み取り専用で実行。2026-10-19 JSTの現行公開版 `e31b5fec1ef3` に対し、以下を確認。

- Pages公開版とSW/JS/CSSの同一ビルド
- Cloudflare WorkerのBrowser Rendering・KV
- 烏丸線の全駅静的ダイヤ・丸太町の両方向・発車時刻
- 京都市バス・北3の実測接近
- 近鉄列車位置の実測
- 地図タイル、CORS

**京都バスODPTリアルタイムは任意未設定で、実測接続成功ではない。**
Cloudflare Workerの読み取り専用設定確認でも、BROWSER・LIVE_KV・LIMIT・APP_ORIGIN・STOP_NAMESのBindingと毎時15分のCronは存在するが、ODPT_CONSUMER_KEY secretは存在しない。
`verify:all-providers` の厳格受入では `blocked_external` とする。
この結果は現行本番に対する診断であり、未公開E候補の実交通API動作を直接確認した結果ではない。

## E-4. 公開ガード

- `.github/workflows/pages.yml`: 手動公開時も事前のCheck/Test/Chromium/WebKit/PWA/Worker dry-runを省略できない。
- GitHub PagesとCloudflare Workerの公開ジョブは `main` でしか実行できない。
- Eのワークフローは `chat/e-prepublication-audit-20261019` のみで起動し、配信処理を含まない。
- Eの静的リリース検証結果と本番診断を別々のArtifactとして保存。
- 公開前にGitHub Pages/CloudflareのActions秘密情報と権限を再確認すること（秘密値はログに出さない）。

## E-5. 公開許可前の必須受入

1. **物理iPhoneの受入:** Safari/Home画面PWA、VoiceOver、画面ロック/バックグラウンド復帰、実端末GPS/通知/触覚APIの動作。
2. **実走:** 烏丸線の双方向、竹田での近鉄直通、市バス環状と逆方向、同一停留所の方向判定、北3。計測がない検知時間や誤判定率を「合格」と扱わない。
3. **京都バスODPT:** 有効なキーをCloudflare secretに安全に設定後、車両情報の実取得、データ鮮度を確認。不能の場合は公式時刻表のfallbackを明示し、総合受入を保留。
4. **公開直前:** E候補ブランチをmainへ明示的に反映してから、PagesとWorkerの公開ログを確認し、`EXPECTED_BUILD_VERSION` を一致させた公開後API検証と実端末PWA更新を確認する。現在は反映しない。

過去の[78要件対応表](spec-completion-2026-10-16.md)が残す実機/外部接続のP0条件を、この監査で合格扱いへ書き換えない。
