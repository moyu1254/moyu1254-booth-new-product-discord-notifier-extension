# BOOTH New Product Discord Notifier Extension

BOOTH の指定タグに新商品が追加されたとき、拡張機能内の一覧と必要に応じて Discord Webhook に通知するブラウザ拡張です。  
これは [moyu1254/booth-new-product-discord-notifier.git](https://github.com/moyu1254/booth-new-product-discord-notifier.git) をブラウザ拡張として移植したものです。

## できること

- ブラウザ起動時にチェック
- ブラウザを開いている間の定期チェック
- BOOTH タグを複数指定して監視
- 新着商品を拡張機能ポップアップの `新着商品一覧` に追加
- 拡張機能アイコンに未読件数を表示
- 必要に応じて Discord Webhook にも通知
- 成人向け商品を一覧と Discord 上で判別しやすく表示
- 初回設定時は既存商品を通知せず、次回以降の新商品だけを追跡

## 仕組み

この拡張機能では、新商品が見つかると次の 2 か所に反映されます。

- `新着商品一覧`
  拡張機能のポップアップ内に新着商品を追加します。価格とタグに加えて、成人向け商品には `成人向け` バッジを表示します。
- `未読バッジ`
  ポップアップを開くまで、拡張機能アイコンに未読件数を表示します。

Discord 通知を有効にしている場合は、同じ商品を Discord Webhook にも送信します。成人向け商品は Discord 側でもタイトル接頭辞、区分欄、色で判別しやすくしています。

## 導入方法

### GitHub Releases から導入する

1. GitHub Releases から使いたいブラウザ向け ZIP をダウンロードして展開します
2. ブラウザに展開済みフォルダを読み込みます
3. 拡張機能の設定画面で `Discord Webhook URL` と `BOOTHタグ` を設定します

### Chromium 系ブラウザ

対応例: Chrome / Edge / Brave / Vivaldi

1. GitHub Releases から `booth-new-product-discord-notifier-extension-chromium-v*.zip` をダウンロードします
2. ZIP を展開します
3. `chrome://extensions` を開きます
4. `デベロッパー モード` を有効にします
5. `パッケージ化されていない拡張機能を読み込む` を選び、展開したフォルダを指定します

### Firefox

1. GitHub Releases から `booth-new-product-discord-notifier-extension-firefox-v*.zip` をダウンロードします
2. ZIP を展開します
3. `about:debugging#/runtime/this-firefox` を開きます
4. `Load Temporary Add-on...` から展開したフォルダの `manifest.json` を選択します

## 開発用の読み込み

### Chromium 系ブラウザ

1. `chrome://extensions` を開きます
2. `デベロッパー モード` を有効にします
3. `パッケージ化されていない拡張機能を読み込む` を選びます
4. このリポジトリのフォルダを指定します

### Firefox

Firefox 版は別 manifest でビルドします。

```powershell
./scripts/build-firefox.ps1
```

ビルド後、`about:debugging#/runtime/this-firefox` を開き、`Load Temporary Add-on...` から `dist/firefox/manifest.json` を選択してください。

## 設定項目

| 項目 | 説明 |
| --- | --- |
| Discord Webhook URL | Discord に通知する場合の Webhook URL |
| BOOTHタグ | 監視する BOOTH タグ。1 行に 1 タグ |
| 定期チェック間隔（分） | 定期チェックの実行間隔 |
| 成人向け商品を検索結果に含める | BOOTH 検索に `adult=include` を付けます |
| 初回は既存商品を通知せず、次回以降の新商品だけ通知する | 初回登録時の大量通知を避けます |
| Discord に通知する | Discord Webhook への送信を有効にします |

## 成人向け商品の扱い

- BOOTH 側で成人向け商品の表示が許可されていないと、検索結果に出ない場合があります
- 同じブラウザで BOOTH にログインし、BOOTH 側の成人向け表示設定を有効にしてください
- 成人向け検索で結果が 0 件だった場合は通常検索へフォールバックし、最終実行結果にその旨を表示します
- `新着商品一覧` では成人向け商品に `成人向け` バッジを表示します
- Discord 通知ではタイトルに `[成人向け]` を付け、区分欄にも `成人向け` を表示します

## 動作仕様

### Chromium 系

- ルートの `manifest.json` を使います
- `chrome.runtime.onStartup` でブラウザ起動時にチェックします
- `chrome.runtime.onInstalled` でインストール時または更新時にチェックします
- ブラウザが起動している間は `chrome.alarms` で定期チェックします
- ブラウザが閉じている間や PC がスリープしている間は実行されません

### Firefox

- `manifests/firefox.json` を元に Firefox 用パッケージを作成します
- Firefox では `background.service_worker` と `chrome.offscreen` に依存しない構成に分けています
- HTML の解析は Firefox の background script 上の `DOMParser` で行います

## リリース手順

リリース用 ZIP は GitHub Actions で自動生成されます。

1. `manifest.json` の `version` を更新します
2. 必要な変更をコミットします
3. タグを作成して push します

```bash
git tag v1.0.0
git push origin v1.0.0
```

タグ push 後、`Package Extension` workflow が GitHub Release を作成し、`dist/packages/*.zip` を添付します。

ローカルでビルドだけ確認したい場合は次を実行します。

```powershell
./scripts/build-release.ps1
```

## 権限

| 権限 | 用途 |
| --- | --- |
| `alarms` | 定期チェック |
| `storage` | 設定、通知済み商品 ID、新着商品一覧、未読件数の保存 |
| `offscreen` | Chromium 系で BOOTH の HTML を解析 |
| `https://booth.pm/*` | BOOTH 商品検索ページの取得 |
| `https://discord.com/api/webhooks/*` | Discord Webhook への通知 |

## データ保存

- Discord Webhook URL はブラウザ同期ストレージではなく端末ローカルの拡張ストレージに保存します
- 旧バージョンで同期ストレージに保存済みの設定は、起動時または設定画面表示時にローカルへ移行し、同期ストレージから削除します
- 新着商品一覧と未読件数もローカルに保存します

## 制限事項

- BOOTH の HTML 構造が変わると商品カードの解析に失敗する可能性があります
- 成人向け商品の判定は、BOOTH の商品カード上に表示される文言をもとに行っています
- Firefox の `Load Temporary Add-on...` は一時読み込みのため、ブラウザ再起動後は再読み込みが必要です

## ライセンス

このリポジトリは MIT License です。元リポジトリ [moyu1254/booth-new-product-discord-notifier.git](https://github.com/moyu1254/booth-new-product-discord-notifier.git) も MIT License です。
