# 注釈改修の比較画像・検証原本

Before: main `7897360` / runtime `39364e6da0fc`。Afterの最終対象: runtime `48f36473118b`。390×844、Light、文字100%の同一公式便fixtureで比較。地図タイルを含むfixtureの画像は本番の実走画像ではない。地理タイルの実接続は別のreal-map検査、公式運行情報は実HTMLで確認する。

|画面|Before|After|
|---|---|---|
|今|[画像](before/now-home.png)|[画像](after/now-home.png)|
|検索条件|[画像](before/search-filter.png)|[画像](after/search-filter.png)|
|検索結果|[画像](before/search-results.png)|[画像](after/search-results.png)|
|経路詳細|[画像](before/route-detail.png)|[画像](after/route-detail.png)|
|設定|[画像](before/settings.png)|[画像](after/settings.png)|
|運行情報|[画像](before/operations.png)|[画像](after/operations.png)|

追加操作画像:

- [長押しQuickプルダウン](after/annotation-quick-390-light-1.png)
- [選択した方面の接近詳細](after/annotation-approach-390-light-1.png)
- [地下鉄の予定・推定位置](after/annotation-subway-390-light-1.png)
- [近鉄の実測位置と予測到着](after/annotation-kintetsu-390-light.png)
- [Dark・文字200%の経路詳細](after/annotation-journey-390-dark-2.png)

`operations-before.json` は改修前の実本番API応答。`operations-parsed-after.json` は取得した実際の公式HTMLを新parserで解析した結果であり、本番Worker反映後の応答と混同しない。取得日時はJSONに保存している。

全原本・失敗履歴を含むクラウド保存先: `/workspace/artifacts/mymap-ui-audit-2026-10-18/`。最終の検証結果・公開状況は [改修報告](../../ui-annotation-changes-2026-10-18.md) を参照。
