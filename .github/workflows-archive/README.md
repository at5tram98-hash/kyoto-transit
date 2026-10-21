# 無効化したワークフロー（復元可能）

GitHub Actionsは `.github/workflows/` 直下のファイルだけを実行します。ここにあるファイルは**実行されません**。内容・履歴はそのまま保存しています。

2026-10-21に整理。有効なワークフローは次の4本だけです。

| ファイル | 役割 |
|---|---|
| `workflows/pr-quality.yml` | mainへのPRでcheck・test・build・Worker dry-run・Chromium/WebKit・PWAを検証。公開・Secretsなし（PR #1 の同名ワークフローを現行mainへ移植） |
| `workflows/pages.yml` | mainのみ。check・test・build・Chromium/WebKit・PWA・Worker dry-runを通過後にPages公開し、公開後に本番診断 |
| `workflows/worker.yml` | mainのみ。Worker関連の変更時にcheck・test・dry-run後、既存Workerを公開 |
| `workflows/production-health.yml` | 本番の読み取り専用診断（手動・診断スクリプト変更時） |

## 無効化したもの

| ファイル | 元の用途 | 無効化の理由 |
|---|---|---|
| `pages-priority.yml` | 2026-10-19に追加。テストを通さずに `dist` をPagesへ即公開（自身の変更時・手動） | `pages.yml` と同じ `github-pages` 環境へ別のconcurrencyグループで公開するため、未検証の版が公開されたり、検証済みの公開と競合したりする。mainのHEADしか公開できないので、ロールバックの手段にもならない |
| `stage2-subway-bootstrap.yml` | 2026-10-10の一回限りの地下鉄データ初期投入。本番Workerの `/_stage2-refresh` を呼ぶ | 呼び出し先がWorkerから削除済みで、2026-10-10の2回とも失敗。日付が固定。ブランチ制限がなく、どのブランチでも起動しうる |
| `a4-verification.yml` | `chat/a4-evidence-hardening-20261019` 専用の検証 | 作業ブランチ専用。成果はmain（`a3e2f66` 以降）に統合済み。公開処理なし |
| `a5-verification.yml` | `chat/a5-through-continuity-20261019` 専用 | 同上 |
| `b1-verification.yml` | `chat/b1-rail-next-display-20261019` 専用 | 同上 |
| `b2-b5-verification.yml` | `chat/b5-nearby-grouping-20261019` 専用 | 同上 |
| `b6-b7-c1-verification.yml` | `chat/c1-search-input-20261019` 専用 | 同上 |
| `c1-c5-quality-gate.yml` | `chat/c1-c5-quality-audit-20261019` 専用 | 同上 |
| `c2-c5-verification.yml` | `chat/c2-c5-search-ux-20261019` 専用 | 同上 |
| `c6-verification.yml` | `chat/c6-search-recovery-20261019` 専用 | 同上 |
| `c7-browser-operations.yml` | `chat/c7-browser-operations-20261019` 専用 | 同上 |
| `d-integrated-quality.yml` | `chat/d-quality-audit-20261019` 専用 | 同上 |
| `d1-d3-verification.yml` | `chat/d3-motion-quality-20261019` 専用 | 同上 |
| `d4-d5-verification.yml` | `chat/d5-accessibility-polish-20261019` 専用 | 同上 |
| `d6-final-regression.yml` | `chat/d6-final-regression-20261019` 専用 | 同上。同じ検証は `pages.yml` が毎回実行する |
| `e-release-preflight.yml` | `chat/e-prepublication-audit-20261019` 専用の公開前検査 | 同上。`scripts/e-release-preflight.mjs` は残しており、手元で実行できる |

作業ブランチ自体は削除していません。各ブランチには元のワークフローファイルが残っているため、そのブランチへpushすると従来どおり検証が動きます。

## 復元方法

```sh
git mv .github/workflows-archive/<file>.yml .github/workflows/<file>.yml
```

`pages-priority.yml` は戻すとテスト未実行の公開経路が復活するため、`tests/workflow-inventory.test.js` が失敗します。戻す場合はテストとあわせて見直してください。
